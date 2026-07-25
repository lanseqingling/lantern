import { z } from "zod";
import { prisma } from "@lantern/server/db";
import { AppError } from "@lantern/server/errors";
import {
  resolveResourceReference,
  resolveResourceScope,
  resourceReference,
} from "@lantern/server/resource-reference-service";
import { createComicPageViews, validateComicDocument } from "@lantern/shared";
import { createExternalTargetHandle } from "./external-target-handles";

export const externalScopeResolveInputSchema = z.strictObject({
  reference: z.string().trim().min(1).max(2048).optional(),
  comicTitle: z.string().trim().min(1).max(120).optional(),
  chapterTitle: z.string().trim().min(1).max(120).optional(),
  chapterNumber: z.number().int().positive().optional(),
}).refine((value) => Boolean(value.reference || value.comicTitle), {
  message: "请提供 Lantern 引用，或提供准确的漫画名称。",
});

const externalResolvedResourceSchema = z.strictObject({
  type: z.enum(["comic", "chapter", "project"]),
  uri: z.string(),
  label: z.string(),
});

export const externalScopeResolveOutputSchema = z.strictObject({
  comic: externalResolvedResourceSchema,
  chapter: externalResolvedResourceSchema.optional(),
  project: externalResolvedResourceSchema.optional(),
  workingRevision: z.number().int().positive().optional(),
  focus: z.strictObject({
    type: z.literal("presentation_unit"),
    handle: z.string(),
    label: z.string(),
  }).optional(),
});

const defaultHandleLifetimeMs = 15 * 60 * 1000;

export async function resolveExternalAgentScope(
  ownerUserId: string,
  input: z.input<typeof externalScopeResolveInputSchema>,
  options: { now?: number; lifetimeMs?: number } = {},
) {
  const parsed = externalScopeResolveInputSchema.parse(input);
  const resolved = await resolveResourceScope(ownerUserId, parsed);
  const comic = resolved.comicId
    ? await resolveResourceReference(ownerUserId, resourceReference("comic", resolved.comicId).uri, "comic")
    : resolved;
  const chapter = resolved.chapterId
    ? await resolveResourceReference(ownerUserId, resourceReference("chapter", resolved.chapterId).uri, "chapter")
    : undefined;
  const project = resolved.projectId
    ? await resolveResourceReference(ownerUserId, resourceReference("project", resolved.projectId).uri, "project")
    : undefined;
  let focus: z.infer<typeof externalScopeResolveOutputSchema>["focus"];
  if (resolved.focus && project?.projectId && project.workingRevision) {
    const working = await prisma.workingRevision.findUnique({
      where: { projectId_revision: { projectId: project.projectId, revision: project.workingRevision } },
      select: { document: true },
    });
    const page = working
      ? createComicPageViews(validateComicDocument(working.document)).find((candidate) => candidate.id === resolved.focus?.id)
      : undefined;
    if (!page) throw new AppError("target_not_found", "链接指向的页面不存在或已经变化。", 404);
    const now = options.now ?? Date.now();
    focus = {
      type: "presentation_unit",
      label: page.name?.trim() || `Page ${String(page.pageIndex + 1).padStart(2, "0")}`,
      handle: createExternalTargetHandle({
        ownerUserId,
        projectId: project.projectId,
        baseRevision: project.workingRevision,
        expiresAt: now + (options.lifetimeMs ?? defaultHandleLifetimeMs),
        target: {
          type: "presentation_unit",
          pageId: page.id,
          assetVersionIds: [],
          dialogueIds: [],
        },
      }),
    };
  }
  return externalScopeResolveOutputSchema.parse({
    comic: {
      type: "comic",
      uri: resourceReference("comic", comic.id).uri,
      label: comic.displayName,
    },
    ...(chapter ? {
      chapter: {
        type: "chapter",
        uri: resourceReference("chapter", chapter.id).uri,
        label: chapter.displayName,
      },
    } : {}),
    ...(project ? {
      project: {
        type: "project",
        uri: resourceReference("project", project.id).uri,
        label: project.displayName,
      },
      workingRevision: project.workingRevision,
    } : {}),
    ...(focus ? { focus } : {}),
  });
}
