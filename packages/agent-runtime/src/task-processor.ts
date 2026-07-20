import {
  AssetKind,
  CandidateKind,
  CandidateStatus,
  MessageKind,
  MessageRole,
  TaskStatus,
  TaskType,
  type Prisma,
} from "@prisma/client";
import { planEditorCapabilities } from "../../editor-core/src";
import { normalizeStoryboardBeats, validateComicDocument, type WorkspaceOperation } from "../../shared/src";
import { prisma } from "../../server/src/db";
import { AppError } from "../../server/src/errors";
import { getObject, putImage } from "../../server/src/object-storage";
import { DeepSeekProvider } from "./providers/deepseek";
import { QwenImageProvider } from "./providers/qwen-image";
import {
  agentContextSnapshotSchema,
  assetDraftSchema,
  parseCandidatePayload,
  singleFrameStoryboardOutputSchema,
  type AgentContextSnapshot,
} from "./schemas";

const jsonValue = (value: unknown) => value as Prisma.InputJsonValue;

function taskInstruction(task: { input: Prisma.JsonValue }) {
  const input = task.input as { instruction?: string };
  return input.instruction ?? "";
}

function creativeBaseline(context: AgentContextSnapshot) {
  return {
    comic: {
      id: context.comic.id,
      title: context.comic.title,
      format: context.comic.format,
      readingDirection: context.comic.readingDirection,
    },
    visualStyle: {
      summary: context.comic.styleSummary,
      referenceAssets: context.assets.filter((asset) => asset.kind === "style"),
    },
    storyCore: context.comic.summary,
    world: {
      summary: context.comic.worldSummary,
      settings: context.comic.settings,
    },
  };
}

type CandidateDraft = {
  kind: CandidateKind;
  title: string;
  summary: string;
  targetLabel: string;
  payload: unknown;
  operations: WorkspaceOperation[];
  outputRefs?: unknown[];
};

async function loadTask(taskId: string) {
  const task = await prisma.generationTask.findUnique({ where: { id: taskId } });
  if (!task) throw new AppError("not_found", "任务不存在。", 404);
  return task;
}

async function persistCandidate({ task, ...draft }: CandidateDraft & { task: Awaited<ReturnType<typeof loadTask>> }) {
  await prisma.generationTask.update({ where: { id: task.id }, data: { progress: 72 } });
  return prisma.$transaction(async (tx) => {
    const fresh = await tx.generationTask.findUnique({ where: { id: task.id } });
    if (!fresh || fresh.status === TaskStatus.CANCEL_REQUESTED || fresh.status === TaskStatus.CANCELED) {
      if (fresh && fresh.status !== TaskStatus.CANCELED) {
        await tx.generationTask.update({ where: { id: fresh.id }, data: { status: TaskStatus.CANCELED, completedAt: new Date() } });
      }
      throw new AppError("task_canceled", "任务已取消。", 409);
    }
    await tx.generationTask.update({ where: { id: task.id }, data: { progress: 88 } });
    const candidate = await tx.candidate.create({
      data: {
        ownerUserId: task.ownerUserId,
        projectId: task.projectId,
        conversationId: task.conversationId,
        taskId: task.id,
        kind: draft.kind,
        status: CandidateStatus.AVAILABLE,
        title: draft.title,
        changeSummary: draft.summary,
        targetLabel: draft.targetLabel,
        target: task.target as Prisma.InputJsonValue,
        baseRevision: task.baseRevision,
        sourceRefs: jsonValue(agentContextSnapshotSchema.parse(task.contextSnapshot).explicitReferences),
        outputRefs: jsonValue(draft.outputRefs ?? []),
        payload: jsonValue(parseCandidatePayload(draft.kind, draft.payload)),
        operations: jsonValue(draft.operations),
      },
    });
    await tx.generationTask.update({
      where: { id: task.id },
      data: { status: TaskStatus.SUCCEEDED, progress: 100, completedAt: new Date(), errorCode: null, errorMessage: null },
    });
    if (task.conversationId) {
      const taskMessage = await tx.message.findFirst({
        where: { conversationId: task.conversationId, kind: MessageKind.TASK, metadata: { path: ["taskId"], equals: task.id } },
        orderBy: { createdAt: "desc" },
      });
      if (taskMessage) {
        const metadata = taskMessage.metadata as Record<string, unknown>;
        await tx.message.update({
          where: { id: taskMessage.id },
          data: { kind: MessageKind.CANDIDATE, content: draft.summary, metadata: { ...metadata, candidateId: candidate.id, targetLabel: draft.targetLabel } },
        });
      } else {
        await tx.message.create({
          data: {
            ownerUserId: task.ownerUserId,
            projectId: task.projectId,
            conversationId: task.conversationId,
            role: MessageRole.AGENT,
            kind: MessageKind.CANDIDATE,
            content: draft.summary,
            metadata: { taskId: task.id, candidateId: candidate.id, targetLabel: draft.targetLabel },
          },
        });
      }
    }
    return candidate;
  });
}

async function processStoryboard(task: Awaited<ReturnType<typeof loadTask>>) {
  const context = agentContextSnapshotSchema.parse(task.contextSnapshot);
  const frame = context.currentComicFrame;
  if (!frame) throw new AppError("invalid_target", "请先选择要创建或编辑分镜条目的漫画格。", 422);
  const working = await prisma.workingRevision.findFirst({ where: { projectId: task.projectId, revision: task.baseRevision } });
  if (!working) throw new AppError("stale_task", "任务所基于的工作稿已不可用。", 409);
  const document = validateComicDocument(working.document);
  const storyboardBeats = normalizeStoryboardBeats(working.storyboardBeats);
  const existingBeat = frame.linkedStoryboardBeatId ? storyboardBeats.find((beat) => beat.id === frame.linkedStoryboardBeatId) : undefined;
  const output = await new DeepSeekProvider().generateJson({
    schema: singleFrameStoryboardOutputSchema,
    maxTokens: 1400,
    system: "你是 Lantern AI 的单格分镜条目 Agent。只为用户唯一选中的漫画格创建或编辑一个 StoryboardBeat，绝不能生成多方案、多个画格、整页或整话分镜。先遵守漫画创作基线、当前章节、当前页 LCD、相邻分镜与既有条目，再回应用户要求。title 是简短的分镜条目标题；description 应完整说明这一格的场景、人物、动作、情绪、镜头与叙事作用。不要输出坐标、页面布局、对白或图片，也不要修改画格本身。",
    user: JSON.stringify({
      instruction: taskInstruction(task),
      creativeBaseline: creativeBaseline(context),
      chapter: context.chapter,
      selectedFrame: frame,
      existingStoryboardBeat: existingBeat,
      currentPage: { summary: context.currentPage, lcd: context.currentPageLcd },
      nearbyStoryboardBeats: context.storyboardBeats,
      relevantAssets: context.assets,
      recentConversation: context.recentConversation,
      requirements: "只输出 JSON：{title,description,changeSummary}。只描述选中画格，不提供备选方案。",
    }),
  });
  const plan = planEditorCapabilities([existingBeat ? {
    id: "update_storyboard_beat",
    input: { storyboardBeatId: existingBeat.id, patch: { title: output.title, description: output.description } },
  } : {
    id: "create_frame_storyboard_beat",
    input: { unitId: frame.pageId, frameId: frame.id, title: output.title, description: output.description },
  }], {
    fixture: {
      working: {
        documentId: working.id,
        chapterId: context.chapter.id,
        projectId: task.projectId,
        createdAt: working.createdAt.toISOString(),
        state: "working",
        revision: working.revision,
        document,
      },
      storyboardBeats,
    },
    createId: (prefix) => `${prefix}-${task.id}`,
    actor: "agent",
  });
  const targetLabel = context.selection.label ?? `画格 ${String(frame.readingOrder).padStart(2, "0")}`;
  return persistCandidate({
    task,
    kind: CandidateKind.STORYBOARD,
    title: `编辑分镜条目 · ${targetLabel}`,
    summary: output.changeSummary,
    targetLabel,
    payload: { ...output, mode: existingBeat ? "replace" : "create", ...(existingBeat ? { storyboardBeatId: existingBeat.id } : {}) },
    operations: plan.commands,
  });
}

export function preferredReferenceVersionIds(context: Pick<AgentContextSnapshot, "explicitReferences" | "assets">, requiredVersionIds: string[] = []) {
  const explicitVersionIds = context.explicitReferences.map((reference) => reference.versionId).filter((id): id is string => Boolean(id));
  const contextualVersionIds = explicitVersionIds.length
    ? explicitVersionIds
    : context.assets.filter((asset) => asset.kind === "character" || asset.kind === "scene").map((asset) => asset.versionId).filter((id): id is string => Boolean(id));
  return [...new Set([...requiredVersionIds, ...contextualVersionIds])];
}

async function referenceDataUrls(context: AgentContextSnapshot, ownerUserId: string, requiredVersionIds: string[] = []) {
  const preferredVersionIds = preferredReferenceVersionIds(context, requiredVersionIds);
  const versions = await prisma.assetVersion.findMany({
    where: {
      id: { in: preferredVersionIds.slice(0, 3) },
      asset: { ownerUserId, project: { chapter: { comicId: context.comic.id, archivedAt: null } } },
    },
  });
  const urls: string[] = [];
  for (const version of versions) {
    if (!version.objectKey || !version.contentType) continue;
    const bytes = await getObject(version.objectKey);
    if (bytes.length <= 8 * 1024 * 1024) urls.push(`data:${version.contentType};base64,${bytes.toString("base64")}`);
  }
  return urls;
}

async function processFrameImage(task: Awaited<ReturnType<typeof loadTask>>) {
  const context = agentContextSnapshotSchema.parse(task.contextSnapshot);
  const frameContext = context.currentComicFrame;
  if (!frameContext) throw new AppError("invalid_target", "请先选择要生成或替换格内图片的漫画格。", 422);
  const working = await prisma.workingRevision.findFirst({ where: { projectId: task.projectId, revision: task.baseRevision } });
  if (!working) throw new AppError("stale_task", "任务所基于的工作稿已不可用。", 409);
  const document = validateComicDocument(working.document);
  const storyboardBeats = normalizeStoryboardBeats(working.storyboardBeats);
  const unit = document.units.find((item) => item.id === frameContext.pageId);
  const frame = unit?.frames.find((item) => item.id === frameContext.id);
  if (!unit || !frame) throw new AppError("invalid_target", "选中的漫画格已经不存在。", 422);
  const existingImage = frame.layers.flatMap((layer) => layer.kind === "art"
    ? layer.elements.flatMap((element) => element.kind === "image" ? [{ layer, element }] : [])
    : []).find(Boolean);
  const storyboardBeat = frameContext.linkedStoryboardBeatId
    ? storyboardBeats.find((beat) => beat.id === frameContext.linkedStoryboardBeatId)
    : undefined;
  const visualPrompt = [
    `漫画：${context.comic.title}`,
    context.comic.summary ? `故事核心：${context.comic.summary}` : "",
    context.comic.worldSummary ? `世界设定：${context.comic.worldSummary}` : "",
    context.comic.styleSummary ? `视觉风格：${context.comic.styleSummary}` : "",
    storyboardBeat ? `当前分镜：${storyboardBeat.title}。${storyboardBeat.description}` : "",
    `用户要求：${taskInstruction(task)}`,
    "只生成这个画格的漫画成稿图片。保持角色、场景和风格连续性，不要添加对白、气泡、文字、水印或页面边框，不要改变其他画格。",
  ].filter(Boolean).join("\n");
  const generated = await new QwenImageProvider().generate({
    prompt: visualPrompt,
    referenceUrls: await referenceDataUrls(context, task.ownerUserId, existingImage ? [existingImage.element.assetVersionId] : []),
    size: "1024*1024",
  });
  const stored = await putImage(generated.bytes, `frame-candidates/${task.projectId}`);
  const stagingAsset = await prisma.asset.create({
    data: {
      ownerUserId: task.ownerUserId,
      projectId: task.projectId,
      kind: AssetKind.GENERATED_IMAGE,
      name: `${context.selection.label ?? "选中画格"} · 未确认格内图片`,
      description: storyboardBeat?.description ?? taskInstruction(task),
      archivedAt: new Date(),
      versions: { create: { version: 1, objectKey: stored.objectKey, contentType: stored.contentType, byteSize: stored.byteSize, width: stored.width, height: stored.height, checksum: stored.checksum, source: "frame_image_candidate", sourceTaskId: task.id } },
    },
    include: { versions: true },
  });
  const stagingVersion = stagingAsset.versions[0];
  const resource = {
    assetId: stagingAsset.id,
    assetVersionId: stagingVersion.id,
    mediaType: stored.contentType,
    width: stored.width,
    height: stored.height,
  };
  const plan = planEditorCapabilities([existingImage ? {
    id: "replace_frame_image",
    input: { unitId: unit.id, frameId: frame.id, layerId: existingImage.layer.id, elementId: existingImage.element.id, ...resource },
  } : {
    id: "place_frame_image",
    input: { unitId: unit.id, frameId: frame.id, ...resource },
  }], {
    fixture: {
      working: {
        documentId: working.id,
        chapterId: context.chapter.id,
        projectId: task.projectId,
        createdAt: working.createdAt.toISOString(),
        state: "working",
        revision: working.revision,
        document,
      },
      storyboardBeats,
    },
    createId: (prefix) => `${prefix}-${task.id}`,
    actor: "agent",
  });
  const targetLabel = context.selection.label ?? `画格 ${String(frameContext.readingOrder).padStart(2, "0")}`;
  return persistCandidate({
    task,
    kind: CandidateKind.FRAME_IMAGE,
    title: `${existingImage ? "重新生成单格画面" : "生成单格画面"} · ${targetLabel}`,
    summary: existingImage ? "已生成新的格内图片候选；应用后只替换这个画格的当前主图。" : "已生成格内图片候选；应用后只放入这个画格。",
    targetLabel,
    payload: {
      mode: existingImage ? "replace" : "place",
      assetId: stagingAsset.id,
      assetVersionId: stagingVersion.id,
      sourceAssetVersionIds: existingImage ? [existingImage.element.assetVersionId] : [],
    },
    operations: plan.commands,
    outputRefs: [{ objectType: "asset", objectId: stagingAsset.id, versionId: stagingVersion.id }],
  });
}

async function processAssetParse(task: Awaited<ReturnType<typeof loadTask>>) {
  const context = agentContextSnapshotSchema.parse(task.contextSnapshot);
  const draft = await new DeepSeekProvider().generateJson({
    schema: assetDraftSchema,
    maxTokens: 1200,
    system: `你是漫画角色与场景资产整理助手。根据用户已经给出的信息和漫画创作基线直接形成可编辑资产草案，不追问，也不要虚构上传图中不可见的信息。资产必须与故事核心、世界规则和视觉风格一致。
只输出这一种 JSON：{"kind":"character","name":"资产名称","description":"一段完整、可直接用于后续创作的视觉描述"}。
kind 只能是 character 或 scene。description 必须完整包含后续生成需要保持一致的身份、外观、服装、状态、空间、光线或风格信息；只整理视觉设定，不要声称图片已经生成或保存。不要增加外层包装。`,
    user: JSON.stringify({ instruction: taskInstruction(task), creativeBaseline: creativeBaseline(context), relevantAssets: context.assets, recentConversation: context.recentConversation }),
  });
  const baselinePrompt = [
    `漫画：${context.comic.title}（${context.comic.format}，阅读方向 ${context.comic.readingDirection}）`,
    context.comic.summary ? `故事核心：${context.comic.summary}` : "",
    context.comic.worldSummary ? `世界设定：${context.comic.worldSummary}` : "",
    ...context.comic.settings.map((setting) => `${setting.title}：${setting.content}`),
    context.comic.styleSummary ? `视觉风格：${context.comic.styleSummary}` : "",
  ].filter(Boolean).join("\n");
  const visualPrompt = draft.kind === "character"
    ? `${baselinePrompt}\n漫画角色设定图片，单人全身与半身结合，干净中性背景，不要文字。角色：${draft.name}。${draft.description}`
    : `${baselinePrompt}\n漫画场景设定图片，无人物，清楚表现空间关系和主要光线，不要文字。场景：${draft.name}。${draft.description}`;
  const visualStyleVersionIds = context.assets.filter((asset) => asset.kind === "style").map((asset) => asset.versionId).filter((versionId): versionId is string => Boolean(versionId));
  const generated = await new QwenImageProvider().generate({
    prompt: visualPrompt,
    referenceUrls: await referenceDataUrls(context, task.ownerUserId, visualStyleVersionIds),
    size: "1024*1024",
  });
  const stored = await putImage(generated.bytes, `asset-candidates/${task.projectId}`);
  const stagingAsset = await prisma.$transaction(async (tx) => {
    const created = await tx.asset.create({
      data: {
        ownerUserId: task.ownerUserId,
        projectId: task.projectId,
        kind: AssetKind.GENERATED_IMAGE,
        name: `${draft.name} · 未确认图片`,
        description: draft.description,
        archivedAt: new Date(),
        versions: { create: { version: 1, objectKey: stored.objectKey, contentType: stored.contentType, byteSize: stored.byteSize, width: stored.width, height: stored.height, checksum: stored.checksum, source: "asset_candidate", sourceTaskId: task.id } },
      },
      include: { versions: true },
    });
    await tx.assetImage.create({ data: { assetId: created.id, assetVersionId: created.versions[0].id, label: "主图", sortIndex: 0 } });
    return created;
  });
  const stagingVersion = stagingAsset.versions[0];
  return persistCandidate({
    task,
    kind: CandidateKind.ASSET,
    title: `${draft.name} · ${draft.kind === "character" ? "角色" : "场景"}候选`,
    summary: draft.description,
    targetLabel: "资产库",
    payload: { ...draft, sourceAssetVersionIds: [stagingVersion.id] },
    operations: [],
    outputRefs: [{ objectType: "asset", objectId: stagingAsset.id, versionId: stagingVersion.id }],
  });
}

export async function processGenerationTask(taskId: string) {
  const task = await loadTask(taskId);
  if (task.status === TaskStatus.CANCELED || task.status === TaskStatus.CANCEL_REQUESTED) return;
  const attemptCount = await prisma.generationAttempt.count({ where: { taskId } });
  const claimed = await prisma.$transaction(async (tx) => {
    const result = await tx.generationTask.updateMany({
      where: { id: taskId, status: { in: [TaskStatus.CREATED, TaskStatus.QUEUED] } },
      data: { status: TaskStatus.RUNNING, progress: 18 },
    });
    if (!result.count) return false;
    await tx.generationAttempt.create({ data: { taskId, attempt: attemptCount + 1, status: TaskStatus.RUNNING } });
    return true;
  });
  if (!claimed) return;
  try {
    const candidate = task.type === TaskType.STORYBOARD
      ? await processStoryboard(task)
      : task.type === TaskType.FRAME_IMAGE_GENERATE
        ? await processFrameImage(task)
      : task.type === TaskType.ASSET_PARSE
        ? await processAssetParse(task)
        : (() => { throw new AppError("unsupported_task", "该任务类型尚未开放。", 422); })();
    await prisma.generationAttempt.update({
      where: { taskId_attempt: { taskId, attempt: attemptCount + 1 } },
      data: { status: TaskStatus.SUCCEEDED, completedAt: new Date(), responseMeta: { candidateId: candidate.id } },
    });
    return candidate;
  } catch (error) {
    const appError = error instanceof AppError ? error : new AppError("internal", "任务执行失败，旧内容未改变。", 500);
    if (appError.code !== "task_canceled") {
      await prisma.generationTask.update({
        where: { id: taskId },
        data: { status: TaskStatus.FAILED, errorCode: appError.code, errorMessage: appError.message, completedAt: new Date() },
      });
      if (task.conversationId) {
        const taskMessage = await prisma.message.findFirst({ where: { conversationId: task.conversationId, kind: MessageKind.TASK, metadata: { path: ["taskId"], equals: task.id } }, orderBy: { createdAt: "desc" } });
        if (taskMessage) {
          const metadata = taskMessage.metadata as Record<string, unknown>;
          await prisma.message.update({ where: { id: taskMessage.id }, data: { kind: MessageKind.FAILED, content: appError.message, metadata: { ...metadata, retryable: true } } });
        }
      }
    }
    await prisma.generationAttempt.update({
      where: { taskId_attempt: { taskId, attempt: attemptCount + 1 } },
      data: { status: appError.code === "task_canceled" ? TaskStatus.CANCELED : TaskStatus.FAILED, errorCode: appError.code, errorMessage: appError.message, completedAt: new Date() },
    });
    throw appError;
  }
}
