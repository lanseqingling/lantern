import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import {
  ComicFormat,
  TaskStatus,
  type Prisma,
} from "@prisma/client";
import type { ComicDocument, WorkspaceOperation } from "../packages/shared/src";
import { prisma } from "../packages/server/src/db";
import { exportChapter } from "../packages/server/src/export-renderer";
import { commitChangeSet, getLatestWorking } from "../packages/server/src/workbench-service";
import { createGenerationTask } from "../packages/agent-runtime/src/task-service";
import { processGenerationTask } from "../packages/agent-runtime/src/task-processor";

const suffix = randomUUID();
const ids = {
  user: `smoke-user-${suffix}`,
  comic: `smoke-comic-${suffix}`,
  chapter: `smoke-chapter-${suffix}`,
  project: `smoke-project-${suffix}`,
  conversation: `smoke-conversation-${suffix}`,
};
const testQueue = { enqueue: async () => undefined };

async function runCandidateTask(taskType: "storyboard" | "page_layout" | "frame_image_generate" | "frame_image_refine", instruction: string, selection: { type: string; id?: string; pageId?: string; label?: string }) {
  const task = await createGenerationTask({
    ownerUserId: ids.user,
    projectId: ids.project,
    conversationId: ids.conversation,
    taskType,
    instruction,
    scope: taskType === "storyboard" || taskType === "page_layout" ? "whole_chapter" : "selected_comic_frame",
    selection,
    explicitReferences: [],
    idempotencyKey: `smoke:${taskType}:${randomUUID()}`,
  }, testQueue);
  await processGenerationTask(task.id);
  const candidate = await prisma.candidate.findFirstOrThrow({ where: { taskId: task.id, status: "AVAILABLE" }, orderBy: { createdAt: "asc" } });
  const result = await commitChangeSet({
    ownerUserId: ids.user,
    projectId: ids.project,
    expectedRevision: candidate.baseRevision,
    candidateId: candidate.id,
    changeSet: {
      id: `smoke-apply:${candidate.id}`,
      projectId: ids.project,
      baseRevision: candidate.baseRevision,
      source: "candidate",
      sourceCandidateId: candidate.id,
      commands: candidate.operations as unknown as WorkspaceOperation[],
    },
  });
  return { task, candidate, result };
}

async function cleanup() {
  await prisma.candidate.deleteMany({ where: { projectId: ids.project } });
  await prisma.pageVariant.deleteMany({ where: { projectId: ids.project } });
  await prisma.generationAttempt.deleteMany({ where: { task: { projectId: ids.project } } });
  await prisma.generationTask.deleteMany({ where: { projectId: ids.project } });
  const messages = await prisma.message.findMany({ where: { projectId: ids.project }, select: { id: true } });
  await prisma.messageReference.deleteMany({ where: { messageId: { in: messages.map((message) => message.id) } } });
  await prisma.message.deleteMany({ where: { projectId: ids.project } });
  await prisma.agentConversation.deleteMany({ where: { projectId: ids.project } });
  await prisma.canvasReferencePlacement.deleteMany({ where: { projectId: ids.project } });
  await prisma.savedSnapshot.deleteMany({ where: { projectId: ids.project } });
  await prisma.storyboardBeatVersion.deleteMany({ where: { storyboardBeat: { projectId: ids.project } } });
  await prisma.storyboardBeat.deleteMany({ where: { projectId: ids.project } });
  await prisma.assetVersion.deleteMany({ where: { asset: { projectId: ids.project } } });
  await prisma.asset.deleteMany({ where: { projectId: ids.project } });
  await prisma.workingRevision.deleteMany({ where: { projectId: ids.project } });
  await prisma.project.deleteMany({ where: { id: ids.project } });
  await prisma.chapter.deleteMany({ where: { id: ids.chapter } });
  await prisma.comic.deleteMany({ where: { id: ids.comic } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
  await rm(process.env.OBJECT_STORAGE_LOCAL_DIR ?? ".lantern-runtime/smoke-objects", { recursive: true, force: true });
  await prisma.$disconnect();
}

async function main() {
  try {
    await prisma.user.create({ data: { id: ids.user, email: `${suffix}@smoke.lantern.local`, displayName: "persistent runtime Smoke" } });
    await prisma.comic.create({ data: { id: ids.comic, ownerUserId: ids.user, title: "真实闭环冒烟", summary: "雨夜车站的短篇冒烟测试", format: ComicFormat.PAGE, styleSummary: "日式轻线条黑白漫画" } });
    await prisma.chapter.create({ data: { id: ids.chapter, ownerUserId: ids.user, comicId: ids.comic, number: 1, title: "第一话", summary: "少女在雨夜发现一张警告车票" } });
    await prisma.project.create({ data: { id: ids.project, ownerUserId: ids.user, chapterId: ids.chapter } });
    await prisma.agentConversation.create({ data: { id: ids.conversation, ownerUserId: ids.user, projectId: ids.project, title: "真实闭环" } });
    const blank: ComicDocument = {
      protocolVersion: "lcd-0.4",
      comicId: ids.comic,
      chapterId: ids.chapter,
      format: "page",
      reading: { viewer: "paged", direction: "ltr", unitOrder: [`${ids.chapter}-page-1`], showPageNumber: true, gap: 24 },
      units: [{ id: `${ids.chapter}-page-1`, kind: "single_page", canvas: { width: 720, height: 1080, background: { color: "#ffffff" } }, surfaces: [{ id: `${ids.chapter}-surface-1`, role: "single", geometry: { x: 0, y: 0, width: 720, height: 1080 }, pageNumber: 1 }], frames: [], overlayLayers: [], readingSequence: [], layoutPolicy: { frameOverlap: "forbid", defaultOverflow: "clip" } }],
      resources: [],
      dialogues: [],
    };
    await prisma.workingRevision.create({ data: { projectId: ids.project, revision: 1, document: blank as unknown as Prisma.InputJsonValue, storyboardBeats: [], storyboardBeatVersionHeads: {}, assetVersionHeads: {} } });

    const storyboard = await runCandidateTask("storyboard", "把少女在雨夜车站捡到父亲旧车票、被警告不要上末班车的故事拆成 4 格分镜。", { type: "chapter" });
    assert.equal(storyboard.task.status, TaskStatus.QUEUED);
    await runCandidateTask("page_layout", "编排成有重点格和节奏变化的页漫，不要平均横切。", { type: "chapter" });
    let working = await getLatestWorking(ids.project);
    let document = working.document as unknown as ComicDocument;
    const unit = document.units[0]; const frame = unit?.frames[0];
    assert(frame);
    await runCandidateTask("frame_image_generate", "生成雨夜末班车站的第一格黑白漫画画面，不要文字。", { type: "comic_frame", id: frame.id, pageId: unit.id, label: "第一格" });

    working = await getLatestWorking(ids.project);
    document = working.document as unknown as ComicDocument;
    const image = document.units.flatMap((item) => item.frames.flatMap((candidateFrame) => candidateFrame.layers.flatMap((layer) => layer.kind === "art" ? layer.elements.map((element) => ({ unit: item, element })) : [])))[0];
    assert(image);
    await runCandidateTask("frame_image_refine", "保留人物与构图，只让雨势更明显、光影更克制。", { type: "image", id: image.element.id, pageId: image.unit.id, label: "第一格图片" });

    working = await getLatestWorking(ids.project);
    document = working.document as unknown as ComicDocument;
    const snapshot = await prisma.savedSnapshot.create({ data: {
      ownerUserId: ids.user,
      chapterId: ids.chapter,
      projectId: ids.project,
      sourceWorkingRevision: working.revision,
      document: working.document as Prisma.InputJsonValue,
      storyboardBeatVersions: working.storyboardBeatVersionHeads as Prisma.InputJsonValue,
      assetVersions: working.assetVersionHeads as Prisma.InputJsonValue,
    } });
    const [png, json] = await Promise.all([
      exportChapter({ projectId: ids.project, document, storyboardBeats: working.storyboardBeats, assetVersions: working.assetVersionHeads, kind: "png" }),
      exportChapter({ projectId: ids.project, document, storyboardBeats: working.storyboardBeats, assetVersions: working.assetVersionHeads, kind: "json" }),
    ]);
    assert(png.length > 0 && json.length === 1);
    console.log(JSON.stringify({ ok: true, workingRevision: working.revision, panelCount: (working.storyboardBeats as unknown[]).length, pageCount: document.units.length, generatedAssets: document.resources.length, snapshotRevision: snapshot.sourceWorkingRevision, pngArtifacts: png.length, jsonArtifacts: json.length }));
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
