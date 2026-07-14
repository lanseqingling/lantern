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
import { normalizeStoryboardBeats, validateComicDocument, type ArtElement, type StoryboardBeat, type WorkspaceOperation } from "../../shared/src";
import { compileChapterLayoutPlan, type ChapterLayoutPlan } from "../../layout-engine/src";
import { prisma } from "../../server/src/db";
import { AppError } from "../../server/src/errors";
import { getConfig } from "../../server/src/config";
import { getObject, putImage } from "../../server/src/object-storage";
import { exportChapter, type ExportKind } from "../../server/src/export-renderer";
import { DeepSeekProvider } from "./providers/deepseek";
import { QwenImageProvider } from "./providers/qwen-image";
import {
  agentContextSnapshotSchema,
  assetDraftSchema,
  dialogueOutputSchema,
  parseCandidatePayload,
  storyboardOutputSchema,
  type AgentContextSnapshot,
} from "./schemas";

const jsonValue = (value: unknown) => value as Prisma.InputJsonValue;

function taskInstruction(task: { input: Prisma.JsonValue }) {
  const input = task.input as { instruction?: string };
  return input.instruction ?? "";
}

function chapterLayoutPlan(format: AgentContextSnapshot["comic"]["format"], storyboardBeats: StoryboardBeat[]): ChapterLayoutPlan {
  return {
    format,
    preset: format === "vertical" ? "vertical_basic" : format === "four_panel" ? "four_panel_grid" : "page_basic",
    readingOrder: storyboardBeats.map((storyboardBeat) => storyboardBeat.id),
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
  canvasPlacement?: { assetId: string; assetVersionId: string; x: number; y: number; zIndex?: number };
};

async function persistCandidates(
  task: Awaited<ReturnType<typeof loadTask>>,
  drafts: CandidateDraft[],
) {
  return prisma.$transaction(async (tx) => {
    const fresh = await tx.generationTask.findUnique({ where: { id: task.id } });
    if (!fresh || fresh.status === TaskStatus.CANCEL_REQUESTED || fresh.status === TaskStatus.CANCELED) {
      if (fresh && fresh.status !== TaskStatus.CANCELED) await tx.generationTask.update({ where: { id: fresh.id }, data: { status: TaskStatus.CANCELED, completedAt: new Date() } });
      throw new AppError("task_canceled", "任务已取消。", 409);
    }
    const candidates = [];
    for (const draft of drafts) {
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
      candidates.push(candidate);
      if (draft.canvasPlacement) {
        // Keep provider output staged until the candidate and its canvas anchor
        // can be published atomically. Cancellation or a persistence failure
        // must not leak an orphan generated asset into the workspace.
        await tx.asset.updateMany({
          where: {
            id: draft.canvasPlacement.assetId,
            ownerUserId: task.ownerUserId,
            projectId: task.projectId,
            archivedAt: { not: null },
          },
          data: { archivedAt: null },
        });
        await tx.canvasReferencePlacement.create({
          data: {
            ownerUserId: task.ownerUserId,
            projectId: task.projectId,
            assetId: draft.canvasPlacement.assetId,
            assetVersionId: draft.canvasPlacement.assetVersionId,
            x: draft.canvasPlacement.x,
            y: draft.canvasPlacement.y,
            zIndex: draft.canvasPlacement.zIndex ?? 20,
          },
        });
      }
    }
    await tx.generationTask.update({
      where: { id: task.id },
      data: { status: TaskStatus.SUCCEEDED, progress: 100, completedAt: new Date(), errorCode: null, errorMessage: null },
    });
    if (task.conversationId) {
      for (let index = 0; index < candidates.length; index += 1) {
        await tx.message.create({
          data: {
            ownerUserId: task.ownerUserId,
            projectId: task.projectId,
            conversationId: task.conversationId,
            role: MessageRole.AGENT,
            kind: MessageKind.CANDIDATE,
            content: drafts[index].summary,
            metadata: { taskId: task.id, candidateId: candidates[index].id, targetLabel: drafts[index].targetLabel },
          },
        });
      }
    }
    return candidates;
  });
}

async function persistCandidate(args: CandidateDraft & { task: Awaited<ReturnType<typeof loadTask>> }) {
  return (await persistCandidates(args.task, [args]))[0];
}

async function loadTask(taskId: string) {
  const task = await prisma.generationTask.findUnique({ where: { id: taskId } });
  if (!task) throw new AppError("not_found", "任务不存在。", 404);
  return task;
}

async function processStoryboard(task: Awaited<ReturnType<typeof loadTask>>) {
  const context = agentContextSnapshotSchema.parse(task.contextSnapshot);
  const output = await new DeepSeekProvider().generateJson({
    schema: storyboardOutputSchema,
    maxTokens: 4200,
    system: `你是 Lantern AI 的分镜 Agent。把故事拆成 1 到 3 个可比较的结构化漫画分镜方案。每个单格只输出简短标题和通用描述；描述可以包含场景、人物、动作、情绪、镜头与叙事作用。不要输出坐标或对白，对白由独立对象管理。保持画面与阅读节奏连续。`,
    user: JSON.stringify({
      instruction: taskInstruction(task),
      comic: context.comic,
      chapter: context.chapter,
      existingStoryboardBeats: context.storyboardBeats,
      relevantAssets: context.assets,
      recentConversation: context.recentConversation,
      requirements: "输出 JSON：{options:[{id,title,pacingIntent,storyboardBeats:[{temporaryId,title,description}]}]}。单格 title 不超过 40 字，description 使用自然语言完整描述画面；每个方案 4-8 格。",
    }),
  });
  const drafts = output.options.map((option, optionIndex): CandidateDraft => {
    const storyboardBeats: StoryboardBeat[] = option.storyboardBeats.map((storyboardBeat, beatIndex) => ({
      id: `beat-${task.id.slice(-8)}-${optionIndex + 1}-${beatIndex + 1}`,
      versionId: `beat-${task.id.slice(-8)}-${optionIndex + 1}-${beatIndex + 1}-candidate-v1`,
      title: storyboardBeat.title,
      description: storyboardBeat.description,
    }));
    return {
      kind: CandidateKind.STORYBOARD,
      title: option.title,
      summary: `${option.pacingIntent}（${option.storyboardBeats.length} 个分镜条目）`,
      targetLabel: "当前一话",
      payload: { option, optionIndex, optionCount: output.options.length },
      operations: [
        { type: "replace_storyboard_beats", storyboardBeats },
      ],
    };
  });
  return (await persistCandidates(task, drafts))[0];
}

async function processPageLayout(task: Awaited<ReturnType<typeof loadTask>>) {
  const context = agentContextSnapshotSchema.parse(task.contextSnapshot);
  // The model gets a bounded narrative window, but applying a chapter layout
  // must never silently discard off-window confirmed beats.
  const working = await prisma.workingRevision.findFirst({
    where: { projectId: task.projectId, revision: task.baseRevision },
  });
  if (!working) throw new AppError("stale_task", "编排所基于的工作稿已不可用。", 409);
  const chapterStoryboardBeats = normalizeStoryboardBeats(working.storyboardBeats);
  if (!chapterStoryboardBeats.length) throw new AppError("invalid_target", "请先确认至少一个分镜条目，再进行页面编排。", 422);
  const requested = taskInstruction(task);
  const format = /条漫/.test(requested) ? "vertical" : /四格/.test(requested) && chapterStoryboardBeats.length === 4 ? "four_panel" : context.comic.format;
  const document = compileChapterLayoutPlan(chapterLayoutPlan(format, chapterStoryboardBeats), chapterStoryboardBeats);
  document.comicId = context.comic.id;
  document.chapterId = context.chapter.id;
  return persistCandidate({
    task,
    kind: CandidateKind.PAGE_LAYOUT,
    title: format === "vertical" ? "条漫滚动编排" : format === "four_panel" ? "固定四格编排" : "页漫节奏编排",
    summary: `按 ${format} 格式生成确定性编排候选，StoryboardBeat 叙事内容保持不变。`,
    targetLabel: "当前一话编排",
    payload: { format, readingOrder: chapterStoryboardBeats.map((storyboardBeat) => storyboardBeat.id) },
    operations: [{ type: "replace_chapter_layout", document }],
  });
}

export function preferredReferenceVersionIds(context: Pick<AgentContextSnapshot, "explicitReferences" | "assets">, requiredVersionIds: string[] = []) {
  const explicitVersionIds = context.explicitReferences.map((ref) => ref.versionId).filter((id): id is string => Boolean(id));
  const contextualVersionIds = explicitVersionIds.length
    ? explicitVersionIds
    : context.assets.filter((asset) => asset.kind === "character" || asset.kind === "scene").map((asset) => asset.versionId).filter((id): id is string => Boolean(id));
  return [...new Set([...requiredVersionIds, ...contextualVersionIds])];
}

async function referenceDataUrls(context: AgentContextSnapshot, requiredVersionIds: string[] = []) {
  const preferredVersionIds = preferredReferenceVersionIds(context, requiredVersionIds);
  const versions = await prisma.assetVersion.findMany({
    where: {
      id: { in: preferredVersionIds.slice(0, 3) },
      asset: { projectId: context.projectId },
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
  const current = await prisma.workingRevision.findFirst({ where: { projectId: task.projectId, revision: task.baseRevision } });
  if (!current) throw new AppError("stale_task", "任务所基于的工作稿已不可用。", 409);
  const document = validateComicDocument(structuredClone(current.document));
  const selection = context.selection;
  const unit = document.units.find((item) => item.id === selection.pageId) ?? document.units[0];
  let frame = unit?.frames.find((item) => item.id === selection.id);
  let existingImage: ArtElement | undefined;
  if (!frame && unit) {
    for (const candidateFrame of unit.frames) {
      const found = candidateFrame.layers.flatMap((layer) => layer.kind === "art" ? layer.elements : []).find((element) => element.id === selection.id);
      if (found) { frame = candidateFrame; existingImage = found; break; }
    }
  }
  if (frame && !existingImage) existingImage = frame.layers.flatMap((layer) => layer.kind === "art" ? layer.elements : []).find(() => true);
  if (!unit || !frame) throw new AppError("invalid_target", "请先选择漫画格或格内图片。", 422);
  const primaryBeat = frame.storyRefs.find((reference) => reference.role === "primary") ?? frame.storyRefs[0];

  const prompt = [
    context.comic.styleSummary,
    "单格漫画画面，不要绘制对话气泡和文字。",
    `关联分镜条目：${JSON.stringify(context.currentStoryboardBeat ?? context.storyboardBeats.find((storyboardBeat) => storyboardBeat.id === primaryBeat?.storyboardBeatId) ?? {})}`,
    `用户要求：${taskInstruction(task)}`,
    task.type === TaskType.FRAME_IMAGE_REFINE ? "保留参考图中的角色身份、服装、镜头主构图，只修改用户明确要求的部分。" : "参考角色和场景设定，生成完整可用的单格成稿。",
  ].filter(Boolean).join("\n");
  const result = await new QwenImageProvider().generate({
    prompt,
    referenceUrls: await referenceDataUrls(
      context,
      task.type === TaskType.FRAME_IMAGE_REFINE && existingImage ? [existingImage.assetVersionId] : [],
    ),
    size: "1024*1024",
  });
  const stored = await putImage(result.bytes, `generated/${task.projectId}`);
  const asset = await prisma.asset.create({
    data: {
      ownerUserId: task.ownerUserId,
      projectId: task.projectId,
      kind: AssetKind.GENERATED_IMAGE,
      name: `生成图 · ${selection.label ?? existingImage?.name ?? frame.name ?? "当前格"}`,
      description: taskInstruction(task).slice(0, 300),
      attributes: { provider: "qwen", model: getConfig().IMAGE_MODEL_NAME },
      archivedAt: new Date(),
      versions: {
        create: {
          version: 1,
          objectKey: stored.objectKey,
          contentType: stored.contentType,
          byteSize: stored.byteSize,
          width: stored.width ?? 1024,
          height: stored.height ?? 1024,
          checksum: stored.checksum,
          source: task.type === TaskType.FRAME_IMAGE_REFINE ? "ai_refine" : "ai_generate",
          sourceTaskId: task.id,
        },
      },
    },
    include: { versions: true },
  });
  const version = asset.versions[0];
  const target = task.target as { canvasX?: number; canvasY?: number };
  document.resources.push({
    assetId: asset.id,
    assetVersionId: version.id,
    kind: "image",
    width: version.width ?? 1024,
    height: version.height ?? 1024,
    mediaType: stored.contentType,
  });
  if (existingImage) {
    existingImage.assetId = asset.id;
    existingImage.assetVersionId = version.id;
  } else {
    const image: ArtElement = {
      id: `image-${primaryBeat?.storyboardBeatId ?? frame.id}-${task.id.slice(-8)}`,
      kind: "image",
      assetId: asset.id,
      assetVersionId: version.id,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      transform: { x: 0, y: 0, width: 1, height: 1 },
      name: `${frame.name ?? "当前格"}主图`,
    };
    let artLayer = frame.layers.find((layer) => layer.kind === "art");
    if (!artLayer) {
      artLayer = { id: `${frame.id}-art`, kind: "art", name: "画面", zIndex: 10, visible: true, overflow: "clip", elements: [] };
      frame.layers.push(artLayer);
    }
    artLayer.elements.push(image);
  }
  return persistCandidate({
    task,
    kind: CandidateKind.FRAME_IMAGE,
    title: task.type === TaskType.FRAME_IMAGE_REFINE ? "当前格精修候选" : "当前格图片候选",
    summary: `已生成 ${selection.label ?? "当前格"} 的新图片版本；其他格保持不变。`,
    targetLabel: selection.label ?? "当前格",
    payload: {
      changeSummary: taskInstruction(task),
      promptSummary: prompt.slice(0, 500),
      outputAssetVersionIds: [version.id],
      protectedFields: ["其他分镜条目", "保存快照"],
    },
    operations: [{ type: "replace_chapter_presentation", document }],
    outputRefs: [{ objectType: "asset", objectId: asset.id, versionId: version.id }],
    canvasPlacement: { assetId: asset.id, assetVersionId: version.id, x: target.canvasX ?? 330, y: target.canvasY ?? 130, zIndex: 20 },
  });
}

async function processDialogue(task: Awaited<ReturnType<typeof loadTask>>) {
  const context = agentContextSnapshotSchema.parse(task.contextSnapshot);
  const output = await new DeepSeekProvider().generateJson({
    schema: dialogueOutputSchema,
    maxTokens: 1600,
    system: "你是漫画对白编辑。对白必须简短、符合角色语气和阅读顺序；只改对白，不触发图片重生成。",
    user: JSON.stringify({ instruction: taskInstruction(task), storyboardBeats: context.storyboardBeats, recentConversation: context.recentConversation }),
  });
  const known = new Set(context.storyboardBeats.map((storyboardBeat) => storyboardBeat.id));
  const acceptedLines = output.lines.filter((line) => known.has(line.storyboardBeatId));
  const working = await prisma.workingRevision.findFirst({ where: { projectId: task.projectId }, orderBy: { revision: "desc" } });
  if (!working) throw new AppError("not_found", "工作稿不存在。", 404);
  const document = validateComicDocument(working.document);
  const dialogueByStoryboardBeatId = new Map(document.dialogues.flatMap((dialogue) => dialogue.storyboardBeatId ? [[dialogue.storyboardBeatId, dialogue]] : []));
  const operations: WorkspaceOperation[] = acceptedLines.flatMap((line) => {
    const dialogue = dialogueByStoryboardBeatId.get(line.storyboardBeatId);
    return dialogue ? [{ type: "update_dialogue", dialogueId: dialogue.id, content: line.text }] : [];
  });
  if (!operations.length) throw new AppError("invalid_model_output", "模型没有返回可应用的当前分镜对白。", 422);
  return persistCandidate({
    task,
    kind: CandidateKind.DIALOGUE,
    title: "对白调整候选",
    summary: output.changeSummary,
    targetLabel: context.selection.label ?? "当前分镜",
    payload: {
      changeSummary: output.changeSummary,
      storyboardBeats: acceptedLines.map((line) => ({
        storyboardBeatId: line.storyboardBeatId,
        baseStoryboardBeatVersionId: context.storyboardBeats.find((storyboardBeat) => storyboardBeat.id === line.storyboardBeatId)?.versionId,
        lines: [{ lineId: line.lineId, speaker: line.speaker, text: line.text, balloonShape: line.balloonShape }],
      })),
    },
    operations,
  });
}

async function processAssetParse(task: Awaited<ReturnType<typeof loadTask>>) {
  const context = agentContextSnapshotSchema.parse(task.contextSnapshot);
  const draft = await new DeepSeekProvider().generateJson({
    schema: assetDraftSchema,
    maxTokens: 1200,
    system: `你是漫画角色与场景资产整理助手。根据用户已经给出的信息直接形成可编辑资产草案，不追问，也不要虚构上传图中不可见的信息。
只输出这一种 JSON：{"kind":"character","name":"资产名称","description":"一段完整视觉描述","attributes":{"identity":"稳定身份与外貌","outfit":"服装与时期","personality":"性格与神态","ageStage":"年龄阶段"}}。
kind 只能是 character、scene、style、prop 之一；attributes 的每个值必须是字符串。参考图只能由用户手动上传或明确加入，绝不能在这里创建。角色使用 character 和 identity/outfit/personality/ageStage；场景使用 scene 和 spatialLayout/lighting/time/mood。不要增加外层包装。`,
    user: JSON.stringify({ instruction: taskInstruction(task), existingAssets: context.assets, selection: context.selection }),
  });
  const visualPrompt = draft.kind === "character"
    ? `漫画角色设定参考图，单人全身与半身结合，干净中性背景，不要文字。角色：${draft.name}。${draft.description}。特征：${JSON.stringify(draft.attributes)}`
    : draft.kind === "scene"
      ? `漫画场景设定参考图，无人物，清楚表现空间关系和主要光线，不要文字。场景：${draft.name}。${draft.description}。特征：${JSON.stringify(draft.attributes)}`
      : `漫画创作参考图，不要文字。${draft.name}。${draft.description}`;
  const generated = await new QwenImageProvider().generate({ prompt: visualPrompt, referenceUrls: [], size: "1024*1024" });
  const stored = await putImage(generated.bytes, `asset-candidates/${task.projectId}`);
  const stagingAsset = await prisma.asset.create({
    data: {
      ownerUserId: task.ownerUserId,
      projectId: task.projectId,
      kind: AssetKind.GENERATED_IMAGE,
      name: `${draft.name} · 未确认参考图`,
      description: draft.description,
      archivedAt: new Date(),
      versions: { create: { version: 1, objectKey: stored.objectKey, contentType: stored.contentType, byteSize: stored.byteSize, width: stored.width, height: stored.height, checksum: stored.checksum, source: "asset_candidate", sourceTaskId: task.id } },
    },
    include: { versions: true },
  });
  const stagingVersion = stagingAsset.versions[0];
  return persistCandidate({
    task,
    kind: CandidateKind.ASSET,
    title: `${draft.name} · ${draft.kind === "character" ? "角色" : draft.kind === "scene" ? "场景" : "资产"}候选`,
    summary: draft.description,
    targetLabel: "资产库",
    payload: { ...draft, sourceAssetVersionIds: [stagingVersion.id] },
    operations: [],
    outputRefs: [{ objectType: "asset", objectId: stagingAsset.id, versionId: stagingVersion.id }],
  });
}

async function processExport(task: Awaited<ReturnType<typeof loadTask>>) {
  const working = await prisma.workingRevision.findFirst({ where: { projectId: task.projectId, revision: task.baseRevision } });
  if (!working) throw new AppError("stale_task", "导出所基于的工作稿已不可用。", 409);
  const instruction = taskInstruction(task).toLowerCase();
  const kind: ExportKind = instruction.includes("json") ? "json" : instruction.includes("long") || instruction.includes("长图") ? "long_png" : "png";
  const artifacts = await exportChapter({
    projectId: task.projectId,
    document: validateComicDocument(working.document),
    storyboardBeats: normalizeStoryboardBeats(working.storyboardBeats),
    assetVersions: working.assetVersionHeads,
    kind,
  });
  await prisma.generationTask.update({
    where: { id: task.id },
    data: { status: TaskStatus.SUCCEEDED, progress: 100, completedAt: new Date(), output: jsonValue({ kind, artifacts }) },
  });
  if (task.conversationId) {
    await prisma.message.create({
      data: {
        ownerUserId: task.ownerUserId,
        projectId: task.projectId,
        conversationId: task.conversationId,
        role: MessageRole.AGENT,
        kind: MessageKind.PLAIN,
        content: `${kind === "json" ? "结构化 JSON" : kind === "long_png" ? "长图" : "分页 PNG"} 已导出，共 ${artifacts.length} 个文件。`,
        metadata: { taskId: task.id, exportKind: kind, artifactCount: artifacts.length },
      },
    });
  }
  return { artifacts };
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
    let candidate;
    if (task.type === TaskType.STORYBOARD) candidate = await processStoryboard(task);
    else if (task.type === TaskType.PAGE_LAYOUT) candidate = await processPageLayout(task);
    else if (task.type === TaskType.FRAME_IMAGE_GENERATE || task.type === TaskType.FRAME_IMAGE_REFINE) candidate = await processFrameImage(task);
    else if (task.type === TaskType.DIALOGUE) candidate = await processDialogue(task);
    else if (task.type === TaskType.ASSET_PARSE) candidate = await processAssetParse(task);
    else if (task.type === TaskType.EXPORT) candidate = await processExport(task);
    else throw new AppError("unsupported_task", "该任务类型尚未实现。", 422);
    await prisma.generationAttempt.update({
      where: { taskId_attempt: { taskId, attempt: attemptCount + 1 } },
      data: { status: TaskStatus.SUCCEEDED, completedAt: new Date(), responseMeta: candidate && "id" in candidate ? { candidateId: candidate.id } : { artifactCount: candidate.artifacts.length } },
    });
    return candidate;
  } catch (error) {
    const appError = error instanceof AppError ? error : new AppError("internal", "任务执行失败，旧内容未改变。", 500);
    if (appError.code !== "task_canceled") {
      await prisma.generationTask.update({
        where: { id: taskId },
        data: { status: TaskStatus.FAILED, errorCode: appError.code, errorMessage: appError.message, completedAt: new Date() },
      });
    }
    await prisma.generationAttempt.update({
      where: { taskId_attempt: { taskId, attempt: attemptCount + 1 } },
      data: { status: appError.code === "task_canceled" ? TaskStatus.CANCELED : TaskStatus.FAILED, errorCode: appError.code, errorMessage: appError.message, completedAt: new Date() },
    });
    throw appError;
  }
}
