import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  AssetKind,
  AssetVersionOrigin,
  CandidateKind,
  CandidateStatus,
  ComicFormat,
  MessageKind,
  MessageRole,
  TaskStatus,
  TaskType,
  type Prisma,
} from "@prisma/client";
import { compileChapterLayoutPlan } from "@lantern/layout-engine";
import { initializeDatabaseConnection, prisma } from "@lantern/server/db";
import { archiveAssetFamily, deleteAssetImage, getAssetFamilyDetail, getComicVisualStyle, listComicAssetCards, renameAssetImage, restoreAssetToCanvasList, setPrimaryAssetImage } from "@lantern/server/asset-library-service";
import { duplicateComic } from "@lantern/server/comic-service";
import { putImage } from "@lantern/server/object-storage";
import { commitChangeSet, getWorkbench, revertCandidateApplication } from "@lantern/server/workbench-service";
import { buildAgentContext, buildAgentContextDebugSnapshot } from "@lantern/agent-runtime/context-builder";
import { getExternalAgentContext, inspectExternalAgentComposition, inspectExternalAgentImages, invokeExternalResourceCapability, listExternalAgentProjects } from "@lantern/agent-runtime/external-agent-service";
import { getConfig } from "@lantern/server/config";
import { receiveExternalAssetUpload } from "@lantern/server/external-upload-service";
import { resolveResourceReference } from "@lantern/server/resource-reference-service";
import { LocalTaskRunner } from "@lantern/agent-runtime/local-task-runner";
import { invokeTaskCapability } from "@lantern/agent-runtime/task-service";
import type { StoryboardBeat } from "@lantern/shared";
import { seed } from "../../prisma/seed";

test("database candidate apply and revert preserve version heads atomically", async () => {
  await initializeDatabaseConnection();
  const foreignKeys = await prisma.$queryRawUnsafe<Array<{ foreign_keys: bigint }>>("PRAGMA foreign_keys");
  assert.equal(Number(foreignKeys[0]?.foreign_keys), 1);
  const suffix = randomUUID();
  const ids = {
    user: `it-user-${suffix}`,
    comic: `it-comic-${suffix}`,
    comicSetting: `it-comic-setting-${suffix}`,
    chapter: `it-chapter-${suffix}`,
    project: `it-project-${suffix}`,
    storyboardBeat: `it-storyboardBeat-${suffix}`,
    storyboardBeatV1: `it-storyboardBeat-v1-${suffix}`,
    dialogue: `it-dialogue-${suffix}`,
    asset: `it-asset-${suffix}`,
    assetV1: `it-asset-v1-${suffix}`,
    assetImage: `it-asset-image-${suffix}`,
    assetV2: `it-asset-v2-${suffix}`,
    assetImage2: `it-asset-image-2-${suffix}`,
    assetVariant: `it-asset-variant-${suffix}`,
    assetVariantV1: `it-asset-variant-v1-${suffix}`,
    assetVariantImage: `it-asset-variant-image-${suffix}`,
    visualStyleAsset: `it-visual-style-${suffix}`,
    visualStyleV1: `it-visual-style-v1-${suffix}`,
    visualStyleImage: `it-visual-style-image-${suffix}`,
    task: `it-task-${suffix}`,
    candidate: `it-candidate-${suffix}`,
    sibling: `it-sibling-${suffix}`,
    conversation: `it-conversation-${suffix}`,
    retryMessage: `it-retry-message-${suffix}`,
  };
  const storyboardBeat: StoryboardBeat = {
    id: ids.storyboardBeat,
    versionId: ids.storyboardBeatV1,
    title: "雨夜候车",
    description: "远景中的雨幕与候车亭，角色不安地等待。",
  };
  const document = compileChapterLayoutPlan({ format: "page", preset: "page_basic", readingOrder: [storyboardBeat.id] }, [storyboardBeat], { comicId: ids.comic, chapterId: ids.chapter });
  document.dialogues.push({ id: ids.dialogue, storyboardBeatId: ids.storyboardBeat, storyboardBeatVersionId: ids.storyboardBeatV1, content: "旧对白" });
  let copiedComicId: string | undefined;

  try {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n0YAAAAASUVORK5CYII=", "base64");
    const [assetObject, variantObject, styleObject] = await Promise.all([
      putImage(png, `integration/${suffix}/asset`),
      putImage(png, `integration/${suffix}/variant`),
      putImage(png, `integration/${suffix}/style`),
    ]);
    await prisma.user.create({ data: { id: ids.user, email: `${suffix}@integration.lantern.local`, displayName: "persistent runtime Integration" } });
    await prisma.comic.create({ data: { id: ids.comic, ownerUserId: ids.user, title: "集成测试漫画", summary: "少女在雨夜末班车寻找失踪同学留下的线索。", worldSummary: "雨夜城市会通过末班车留下失踪者线索。", styleSummary: "克制的蓝绿色水彩与电影感夜景。", format: ComicFormat.PAGE } });
    await prisma.comicSetting.create({ data: { id: ids.comicSetting, ownerUserId: ids.user, comicId: ids.comic, title: "禁忌规则", content: "午夜后不得直呼失踪者姓名。", sortIndex: 20 } });
    await prisma.chapter.create({ data: { id: ids.chapter, ownerUserId: ids.user, comicId: ids.comic, number: 1, title: "第一话", summary: "少女循着失踪同学留下的线索登上末班车。" } });
    await prisma.project.create({ data: { id: ids.project, ownerUserId: ids.user, chapterId: ids.chapter } });
    await prisma.storyboardBeat.create({ data: { id: ids.storyboardBeat, ownerUserId: ids.user, projectId: ids.project, currentVersionNumber: 1 } });
    await prisma.storyboardBeatVersion.create({ data: {
      id: ids.storyboardBeatV1,
      storyboardBeatId: ids.storyboardBeat,
      version: 1,
      title: storyboardBeat.title,
      description: storyboardBeat.description,
    } });
    await prisma.asset.create({ data: {
      id: ids.asset,
      ownerUserId: ids.user,
      comicId: ids.comic,
      kind: AssetKind.CHARACTER,
      name: "测试角色",
      description: "必须在布局和对白修改后继续保留",
      versions: { create: { id: ids.assetV1, version: 1, origin: AssetVersionOrigin.UPLOAD, objectKey: assetObject.objectKey } },
    } });
    await prisma.assetImage.create({ data: { id: ids.assetImage, assetId: ids.asset, assetVersionId: ids.assetV1, label: "主图", sortIndex: 0 } });
    await prisma.asset.create({ data: {
      id: ids.assetVariant,
      ownerUserId: ids.user,
      comicId: ids.comic,
      kind: AssetKind.CHARACTER,
      name: "测试角色·回忆时期",
      description: "同一角色的回忆形态",
      variantOfAssetId: ids.asset,
      variantLabel: "回忆时期",
      variantSortIndex: 10,
      versions: { create: { id: ids.assetVariantV1, version: 1, origin: AssetVersionOrigin.UPLOAD, objectKey: variantObject.objectKey } },
    } });
    await prisma.assetImage.create({ data: { id: ids.assetVariantImage, assetId: ids.assetVariant, assetVersionId: ids.assetVariantV1, label: "主图", sortIndex: 0 } });
    await prisma.asset.create({ data: {
      id: ids.visualStyleAsset,
      ownerUserId: ids.user,
      comicId: ids.comic,
      kind: AssetKind.STYLE,
      name: "视觉风格",
      description: "克制的蓝绿色水彩与电影感夜景。",
      versions: { create: { id: ids.visualStyleV1, version: 1, origin: AssetVersionOrigin.UPLOAD, objectKey: styleObject.objectKey } },
    } });
    await prisma.assetImage.create({ data: { id: ids.visualStyleImage, assetId: ids.visualStyleAsset, assetVersionId: ids.visualStyleV1, label: "雨夜色彩参考", sortIndex: 0 } });

    const assetCards = await listComicAssetCards(ids.user, ids.comic);
    assert.deepEqual(assetCards.map((asset) => asset.id), [ids.asset]);
    assert.equal(assetCards[0]?.variantCount, 1);
    const visualStyle = await getComicVisualStyle(ids.user, ids.comic);
    assert.equal(visualStyle.assetId, ids.visualStyleAsset);
    assert.deepEqual(visualStyle.images.map((image) => image.versionId), [ids.visualStyleV1]);
    const assetDetail = await getAssetFamilyDetail(ids.user, ids.assetVariant);
    assert.equal(assetDetail.root.id, ids.asset);
    assert.deepEqual(assetDetail.variants.map((variant) => variant.id), [ids.assetVariant]);
    await assert.rejects(() => getAssetFamilyDetail(`foreign-${suffix}`, ids.asset), /资产不存在/);

    const copied = await duplicateComic(ids.user, ids.comic);
    copiedComicId = copied.comicId;
    const copiedSettings = await prisma.comicSetting.findMany({ where: { comicId: copied.comicId } });
    assert.equal(copiedSettings.length, 1);
    assert.notEqual(copiedSettings[0]?.id, ids.comicSetting);
    assert.equal(copiedSettings[0]?.title, "禁忌规则");
    assert.equal(copiedSettings[0]?.content, "午夜后不得直呼失踪者姓名。");
    const copiedAssets = await prisma.asset.findMany({
      where: { comicId: copied.comicId },
      include: { images: true },
      orderBy: { variantSortIndex: "asc" },
    });
    const copiedRoot = copiedAssets.find((asset) => !asset.variantOfAssetId);
    const copiedVariant = copiedAssets.find((asset) => Boolean(asset.variantOfAssetId));
    assert.ok(copiedRoot && copiedVariant);
    assert.equal(copiedVariant.variantOfAssetId, copiedRoot.id);
    assert.equal(copiedRoot.images.length, 1);
    assert.equal(copiedVariant.images.length, 1);
    const assetObjectV2 = await putImage(png, `integration/${suffix}/asset-v2`);
    await prisma.assetVersion.create({ data: { id: ids.assetV2, assetId: ids.asset, version: 2, origin: AssetVersionOrigin.UPLOAD, objectKey: assetObjectV2.objectKey } });
    await prisma.assetImage.create({ data: { id: ids.assetImage2, assetId: ids.asset, assetVersionId: ids.assetV2, label: "表情参考", sortIndex: 10 } });
    const reorderedAsset = await setPrimaryAssetImage(ids.user, ids.asset, ids.assetImage2);
    assert.equal(reorderedAsset.root.images[0]?.id, ids.assetImage2);
    assert.equal(reorderedAsset.root.images[0]?.isPrimary, true);
    const renamedAsset = await renameAssetImage(ids.user, ids.asset, ids.assetImage2, "雨天表情参考");
    assert.equal(renamedAsset.root.images[0]?.label, "雨天表情参考");
    await prisma.workingRevision.create({ data: {
      projectId: ids.project,
      revision: 1,
      document: document as unknown as Prisma.InputJsonValue,
      storyboardBeats: [storyboardBeat] as unknown as Prisma.InputJsonValue,
      storyboardBeatVersionHeads: { [ids.storyboardBeat]: ids.storyboardBeatV1 },
      assetVersionHeads: { [ids.asset]: ids.assetV1 },
    } });
    const context = await buildAgentContext({
      ownerUserId: ids.user,
      projectId: ids.project,
      taskType: "storyboard",
      instruction: "生成当前格",
      scope: "selected_comic_frame",
      selection: { type: "storyboard_beat", id: ids.storyboardBeat, pageId: document.units[0].id },
      explicitReferences: [{ objectType: "character", objectId: ids.asset, versionId: ids.assetV1 }],
    });
    assert.equal(context.explicitReferences[0].versionId, ids.assetV1);
    assert.deepEqual(context.assets.find((asset) => asset.id === ids.asset)?.images.map((image) => image.versionId), [ids.assetV2, ids.assetV1]);
    const styleContext = context.assets.find((asset) => asset.id === ids.visualStyleAsset);
    assert.equal(styleContext?.description, "克制的蓝绿色水彩与电影感夜景。");
    assert.deepEqual(styleContext?.images.map((image) => image.versionId), [ids.visualStyleV1]);
    assert.equal(context.comic.worldSummary, "雨夜城市会通过末班车留下失踪者线索。");
    assert.equal(context.comic.styleSummary, "克制的蓝绿色水彩与电影感夜景。");
    assert.deepEqual(context.comic.settings, [{ id: ids.comicSetting, title: "禁忌规则", content: "午夜后不得直呼失踪者姓名。" }]);
    const externalProjects = await listExternalAgentProjects(ids.user);
    assert.equal(externalProjects.projects.find((project) => project.projectId === ids.project)?.workingRevision, 1);
    const comicReference = `lantern://comics/${ids.comic}`;
    const chapterReference = `http://localhost:${getConfig().WEB_PORT}/comics/${ids.comic}/chapters/${ids.chapter}`;
    const resolvedComic = await resolveResourceReference(ids.user, comicReference, "comic");
    assert.equal(resolvedComic.id, ids.comic);
    const resolvedChapter = await resolveResourceReference(ids.user, chapterReference, "chapter");
    assert.equal(resolvedChapter.projectId, ids.project);
    assert.equal(resolvedChapter.workingRevision, 1);
    await assert.rejects(
      () => resolveResourceReference(ids.user, `http://localhost:${getConfig().WEB_PORT}/comics/wrong-${ids.comic}/chapters/${ids.chapter}`, "chapter"),
      /不存在或不属于当前用户/,
    );
    const externalComic = await invokeExternalResourceCapability(ids.user, "comic.get", { comic: comicReference });
    assert.equal((externalComic.data as { title: string }).title, "集成测试漫画");
    const createExternalAssetInput = {
      comic: comicReference,
      kind: "character",
      name: "林澄",
      description: "肩长黑发，穿浅色风衣，神态克制。",
      idempotencyKey: `asset-create-${suffix}`,
    } as const;
    const createdExternalAsset = await invokeExternalResourceCapability(ids.user, "asset.create", createExternalAssetInput);
    const replayedExternalAsset = await invokeExternalResourceCapability(ids.user, "asset.create", createExternalAssetInput);
    const createdExternalAssetId = createdExternalAsset.resource?.id;
    assert.ok(createdExternalAssetId);
    assert.equal(replayedExternalAsset.resource?.id, createdExternalAssetId);
    assert.equal(await prisma.asset.count({ where: { ownerUserId: ids.user, name: "林澄" } }), 1);
    assert.equal(createdExternalAsset.effect, "resource_mutation");
    await assert.rejects(() => invokeExternalResourceCapability(ids.user, "asset.create", {
      ...createExternalAssetInput,
      name: "重复键下的另一个角色",
    }), /幂等键已经用于另一项/);

    const createdVariant = await invokeExternalResourceCapability(ids.user, "asset.variant.create", {
      asset: `lantern://assets/${ids.asset}`,
      label: "雨天形态",
      description: "湿发与深色雨衣。",
      idempotencyKey: `asset-variant-create-${suffix}`,
    });
    const createdVariantId = createdVariant.resource?.id;
    assert.ok(createdVariantId);

    const preparedUpload = await invokeExternalResourceCapability(ids.user, "asset.image.upload_prepare", {
      asset: `lantern://assets/${ids.asset}`,
      filename: "rain-reference.png",
      label: "雨天立绘",
      idempotencyKey: `asset-upload-prepare-${suffix}`,
    });
    const uploadTicket = preparedUpload.data as {
      uploadId: string;
      status: string;
      headers: { Authorization: string };
    };
    assert.equal(uploadTicket.status, "pending");
    await receiveExternalAssetUpload(uploadTicket.uploadId, uploadTicket.headers.Authorization, "image/png", png);
    const attachedImage = await invokeExternalResourceCapability(ids.user, "asset.image.attach", {
      asset: `lantern://assets/${ids.asset}`,
      uploadId: uploadTicket.uploadId,
      idempotencyKey: `asset-image-attach-${suffix}`,
    });
    const attached = (attachedImage.data as { attached: { versionId: string; imageId: string } }).attached;
    const replayedAttachment = await invokeExternalResourceCapability(ids.user, "asset.image.attach", {
      asset: `lantern://assets/${ids.asset}`,
      uploadId: uploadTicket.uploadId,
      idempotencyKey: `asset-image-attach-${suffix}`,
    });
    assert.deepEqual((replayedAttachment.data as { attached: { versionId: string; imageId: string } }).attached, attached);
    await invokeExternalResourceCapability(ids.user, "asset.image.rename", {
      asset: `lantern://assets/${ids.asset}`,
      imageId: attached.imageId,
      label: "雨夜主参考",
      idempotencyKey: `asset-image-rename-${suffix}`,
    });
    const primaryImage = await invokeExternalResourceCapability(ids.user, "asset.image.set_primary", {
      asset: `lantern://assets/${ids.asset}`,
      imageId: attached.imageId,
      idempotencyKey: `asset-image-primary-${suffix}`,
    });
    assert.equal((primaryImage.data as { root: { images: Array<{ id: string; versionId: string; isPrimary: boolean }> } }).root.images[0]?.id, attached.imageId);
    assert.equal((primaryImage.data as { root: { images: Array<{ id: string; versionId: string; isPrimary: boolean }> } }).root.images[0]?.versionId, attached.versionId);
    assert.equal((primaryImage.data as { root: { images: Array<{ id: string; versionId: string; isPrimary: boolean }> } }).root.images[0]?.isPrimary, true);
    await invokeExternalResourceCapability(ids.user, "asset.image.archive", {
      asset: `lantern://assets/${ids.asset}`,
      imageId: attached.imageId,
      confirmed: true,
      idempotencyKey: `asset-image-archive-${suffix}`,
    });
    const archivedVariant = await invokeExternalResourceCapability(ids.user, "asset.variant.archive", {
      asset: `lantern://assets/${createdVariantId}`,
      confirmed: true,
      idempotencyKey: `asset-variant-archive-${suffix}`,
    });
    assert.equal((archivedVariant.data as { archivedVariantId: string }).archivedVariantId, createdVariantId);
    assert.equal(await prisma.assetVersion.count({ where: { id: attached.versionId, assetId: ids.asset } }), 1);
    assert.equal(await prisma.assetImage.count({ where: { id: attached.imageId } }), 0);
    const successfulExternalOperations = await prisma.externalAgentOperation.count({
      where: { ownerUserId: ids.user, status: "SUCCEEDED" },
    });
    assert.ok(successfulExternalOperations >= 8);
    const updatedExternalAsset = await invokeExternalResourceCapability(ids.user, "asset.update", {
      asset: `lantern://assets/${createdExternalAssetId}`,
      description: "肩长黑发，浅色风衣，习惯先观察再行动。",
      idempotencyKey: `asset-update-${suffix}`,
    });
    assert.equal((updatedExternalAsset.data as { root: { description: string } }).root.description, "肩长黑发，浅色风衣，习惯先观察再行动。");
    await assert.rejects(
      () => invokeExternalResourceCapability(`foreign-${ids.user}`, "asset.get", { asset: `lantern://assets/${createdExternalAssetId}` }),
      /不存在或不属于当前用户/,
    );
    const archivedExternalAsset = await invokeExternalResourceCapability(ids.user, "asset.archive", {
      asset: `lantern://assets/${createdExternalAssetId}`,
      confirmed: true,
      idempotencyKey: `asset-archive-${suffix}`,
    });
    assert.equal((archivedExternalAsset.data as { deleted: boolean }).deleted, true);
    const externalContext = await getExternalAgentContext(ids.user, {
      projectId: ids.project,
      profile: "visual_observation",
      pageId: document.units[0].id,
    });
    assert.equal(externalContext.baseRevision, 1);
    assert.equal(externalContext.currentPage?.id, document.units[0].id);
    const externalPageTarget = externalContext.targets.find((target) => target.type === "presentation_unit");
    assert.ok(externalPageTarget);
    const compositionInspection = await inspectExternalAgentComposition(ids.user, {
      projectId: ids.project,
      pageHandles: [externalPageTarget.handle],
    });
    assert.equal(compositionInspection.output.baseRevision, 1);
    assert.equal(compositionInspection.output.structure.units[0]?.id, document.units[0].id);
    assert.ok(compositionInspection.output.structure.units[0]?.frames[0]?.handle);
    assert.equal(compositionInspection.output.image.mimeType, "image/png");
    assert.deepEqual([...compositionInspection.image.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const externalAssetTarget = externalContext.targets.find((target) => target.type === "asset" && target.label === "视觉风格");
    assert.ok(externalAssetTarget);
    assert.deepEqual(externalAssetTarget.assetVersionIds, [ids.visualStyleV1]);
    await assert.rejects(() => inspectExternalAgentComposition(ids.user, {
      projectId: ids.project,
      pageHandles: [externalAssetTarget.handle],
    }), /只能使用页面或滚动段 handle/);
    const imageInspection = await inspectExternalAgentImages(ids.user, {
      projectId: ids.project,
      targetHandles: [externalAssetTarget.handle],
      instruction: "描述角色外观",
    }, async (input) => {
      assert.equal(input.ownerUserId, ids.user);
      assert.deepEqual(input.versionIds, [ids.visualStyleV1]);
      return "角色穿着深色雨衣。";
    });
    assert.equal(imageInspection.observation.content, "角色穿着深色雨衣。");
    await assert.rejects(() => inspectExternalAgentImages(`other-${ids.user}`, {
      projectId: ids.project,
      targetHandles: [externalAssetTarget.handle],
    }), /不属于当前创作空间/);
    const expiredContext = await getExternalAgentContext(ids.user, {
      projectId: ids.project,
      profile: "asset_generation",
    }, { now: 1, lifetimeMs: 1 });
    await assert.rejects(() => inspectExternalAgentImages(ids.user, {
      projectId: ids.project,
      targetHandles: [expiredContext.targets[0]!.handle],
    }), /上下文目标已过期/);
    const comicFrame = document.units[0].frames[0];
    assert.ok(comicFrame);
    const enqueuedTaskIds: string[] = [];
    const taskInvocation = {
      ownerUserId: ids.user,
      projectId: ids.project,
      capabilityId: "storyboard.edit_single_entry",
      actor: "external",
      client: { name: "codex", version: "integration" },
      arguments: { instruction: "让雨夜候车的紧张感更明显" },
      selection: { type: "comic_frame", id: comicFrame.id, pageId: document.units[0].id, label: "画格 01" },
      plannerTrace: { source: "integration-test" },
      idempotencyKey: `semantic-capability:${suffix}`,
    } satisfies Parameters<typeof invokeTaskCapability>[0];
    const testTaskQueue = {
      async enqueue(taskId) {
        enqueuedTaskIds.push(taskId);
      },
    } satisfies Parameters<typeof invokeTaskCapability>[1];
    const invokedTask = await invokeTaskCapability(taskInvocation, testTaskQueue);
    assert.deepEqual(enqueuedTaskIds, [invokedTask.id]);
    assert.equal(invokedTask.type, TaskType.STORYBOARD);
    assert.equal(invokedTask.scope, "selected_comic_frame");
    const invocationAudit = invokedTask.input as {
      capability?: { id?: string; version?: number; catalogRevision?: number; catalogHash?: string };
      invocation?: { actor?: string; client?: { name?: string; version?: string }; requestHash?: string };
    };
    assert.deepEqual(invocationAudit.capability && {
      id: invocationAudit.capability.id,
      version: invocationAudit.capability.version,
      catalogRevision: invocationAudit.capability.catalogRevision,
    }, {
      id: "storyboard.edit_single_entry",
      version: 1,
      catalogRevision: 6,
    });
    assert.match(invocationAudit.capability?.catalogHash ?? "", /^[a-f0-9]{64}$/);
    assert.deepEqual(invocationAudit.invocation && {
      actor: invocationAudit.invocation.actor,
      client: invocationAudit.invocation.client,
    }, {
      actor: "external",
      client: { name: "codex", version: "integration" },
    });
    assert.match(invocationAudit.invocation?.requestHash ?? "", /^[a-f0-9]{64}$/);
    await assert.rejects(() => invokeTaskCapability({
      ...taskInvocation,
      arguments: { instruction: "用同一个幂等键提交不同要求" },
    }, testTaskQueue), /这个幂等键已经用于其他调用/);
    assert.deepEqual(enqueuedTaskIds, [invokedTask.id]);
    await prisma.agentConversation.create({ data: { id: ids.conversation, ownerUserId: ids.user, projectId: ids.project, title: "重试卡片测试" } });
    await prisma.message.create({
      data: {
        id: ids.retryMessage,
        ownerUserId: ids.user,
        projectId: ids.project,
        conversationId: ids.conversation,
        role: MessageRole.AGENT,
        kind: MessageKind.FAILED,
        content: "生成失败",
        metadata: { retryable: true },
      },
    });
    const retriedTask = await invokeTaskCapability({
      ...taskInvocation,
      conversationId: ids.conversation,
      replacementMessageId: ids.retryMessage,
      idempotencyKey: `semantic-capability-retry:${suffix}`,
    }, testTaskQueue);
    const retriedMessage = await prisma.message.findUniqueOrThrow({ where: { id: ids.retryMessage } });
    assert.equal(await prisma.message.count({ where: { conversationId: ids.conversation } }), 1);
    assert.equal(retriedMessage.kind, MessageKind.TASK);
    assert.equal((retriedMessage.metadata as { taskId?: string }).taskId, retriedTask.id);
    const frameContext = await buildAgentContext({
      ownerUserId: ids.user,
      projectId: ids.project,
      taskType: "storyboard",
      instruction: "生成这个画格的格内成稿图",
      scope: "selected_comic_frame",
      selection: { type: "comic_frame", id: comicFrame.id, pageId: document.units[0].id },
    });
    assert.equal(frameContext.currentPage?.id, document.units[0].id);
    assert.equal(frameContext.currentPageLcd?.unit.id, document.units[0].id);
    const interactionContext = await buildAgentContext({
      ownerUserId: ids.user,
      projectId: ids.project,
      taskType: "interaction",
      instruction: "重新编排当前页",
      scope: "current_page",
      currentPageId: document.units[0].id,
      visiblePageIds: [document.units[0].id],
      selection: { type: "comic_frame", id: comicFrame.id, pageId: "stale-page", label: "旧页面画格" },
    });
    assert.equal(interactionContext.currentPage?.id, document.units[0].id);
    assert.deepEqual(interactionContext.currentView?.unitIds, [document.units[0].id]);
    assert.deepEqual(interactionContext.selection, { type: "none", pageId: document.units[0].id, label: "当前页面" });
    assert.deepEqual(interactionContext.visiblePageLcd.map((item) => item.unit.id), [document.units[0].id]);
    const referencedFrameContext = await buildAgentContext({
      ownerUserId: ids.user,
      projectId: ids.project,
      taskType: "storyboard",
      instruction: "分析引用画格",
      scope: "reference_only",
      selection: { type: "none" },
      explicitReferences: [{ objectType: "canvas_element", objectId: comicFrame.id, label: "画格 01" }],
    });
    assert.equal(referencedFrameContext.currentPage?.id, document.units[0].id);
    assert.equal(referencedFrameContext.explicitComicFrameReferences[0]?.frameId, comicFrame.id);
    assert.equal(referencedFrameContext.explicitComicFrameReferences[0]?.storyboardBeat?.id, ids.storyboardBeat);
    assert.equal(frameContext.currentComicFrame?.id, comicFrame.id);
    assert.equal(frameContext.currentStoryboardBeat?.id, ids.storyboardBeat);
    const assetContext = await buildAgentContext({
      ownerUserId: ids.user,
      projectId: ids.project,
      taskType: "asset_image_generate",
      instruction: "创建一个符合漫画基线的新角色",
      scope: "reference_only",
      selection: { type: "none", pageId: document.units[0].id },
    });
    assert.equal(assetContext.comic.summary, "少女在雨夜末班车寻找失踪同学留下的线索。");
    assert.equal(assetContext.comic.worldSummary, "雨夜城市会通过末班车留下失踪者线索。");
    assert.equal(assetContext.comic.styleSummary, "克制的蓝绿色水彩与电影感夜景。");
    assert.deepEqual(assetContext.storyboardBeats, []);
    assert.equal(assetContext.currentPageLcd, undefined);
    assert.deepEqual(assetContext.assets.map((asset) => asset.kind), ["style"]);
    const storyboardContext = await buildAgentContext({
      ownerUserId: ids.user,
      projectId: ids.project,
      taskType: "storyboard",
      instruction: "为当前页生成新的分镜方案",
      scope: "current_page",
      selection: { type: "none", pageId: document.units[0].id },
    });
    assert.equal(storyboardContext.chapter.summary, "少女循着失踪同学留下的线索登上末班车。");
    assert.equal(storyboardContext.currentPageLcd?.unit.id, document.units[0].id);
    assert.equal(storyboardContext.storyboardBeats[0]?.id, ids.storyboardBeat);
    const debug = await buildAgentContextDebugSnapshot({
      ownerUserId: ids.user,
      projectId: ids.project,
      taskType: "storyboard",
      instruction: "定位角色、分镜和页面",
      scope: "selected_comic_frame",
      selection: { type: "storyboard_beat", id: ids.storyboardBeat, pageId: document.units[0].id },
      explicitReferences: [{ objectType: "character", objectId: ids.asset, versionId: ids.assetV1 }],
    });
    assert.equal(debug.debugContractVersion, "context-debug-0.5");
    assert.ok(debug.contextIndex.assets.characters.some((asset) => asset.id === ids.asset));
    assert.equal(debug.contextIndex.world.summary, "雨夜城市会通过末班车留下失踪者线索。");
    assert.deepEqual(debug.contextIndex.world.settings, context.comic.settings);
    assert.equal(debug.contextIndex.storyboard.modelStoryboardBeatWindow[0]?.id, ids.storyboardBeat);
    assert.equal(debug.contextIndex.layout.pages[0]?.id, document.units[0].id);
    const detailAfterDelete = await deleteAssetImage(ids.user, ids.asset, ids.assetImage2);
    assert.deepEqual(detailAfterDelete.root.images.map((image) => image.id), [ids.assetImage]);
    await assert.rejects(() => buildAgentContext({
      ownerUserId: ids.user,
      projectId: ids.project,
      taskType: "storyboard",
      instruction: "尝试引用不属于当前空间的版本",
      scope: "selected_comic_frame",
      explicitReferences: [{ objectType: "character", objectId: ids.asset, versionId: `foreign-${suffix}` }],
    }), /引用对象不存在或不属于当前创作空间/);
    await prisma.generationTask.create({ data: {
      id: ids.task,
      ownerUserId: ids.user,
      projectId: ids.project,
      type: TaskType.DIALOGUE,
      capabilityId: "dialogue.generate",
      capabilityVersion: 1,
      status: TaskStatus.SUCCEEDED,
      idempotencyKey: `integration:${suffix}`,
      baseRevision: 1,
      scope: "selected_comic_frame",
      target: { type: "storyboard_beat", id: ids.storyboardBeat },
      input: { instruction: "修改对白" },
      contextSnapshot: {},
      provider: "integration",
      model: "integration",
    } });
    const operations = [{ type: "update_dialogue", dialogueId: ids.dialogue, content: "新对白" }] as const;
    for (const [id, title] of [[ids.candidate, "对白候选 A"], [ids.sibling, "对白候选 B"]] as const) {
      await prisma.candidate.create({ data: {
        id,
        ownerUserId: ids.user,
        projectId: ids.project,
        taskId: ids.task,
        kind: CandidateKind.DIALOGUE,
        status: CandidateStatus.AVAILABLE,
        title,
        changeSummary: "只修改当前格对白",
        targetLabel: "当前格",
        target: { type: "storyboard_beat", id: ids.storyboardBeat },
        baseRevision: 1,
        payload: { changeSummary: "只修改当前格对白" },
        operations: operations as unknown as Prisma.InputJsonValue,
      } });
    }

    await commitChangeSet({
      ownerUserId: ids.user,
      projectId: ids.project,
      expectedRevision: 1,
      candidateId: ids.candidate,
      changeSet: {
        id: `integration-change-${suffix}`,
        projectId: ids.project,
        baseRevision: 1,
        source: "candidate",
        sourceCandidateId: ids.candidate,
        commands: operations.map((operation) => ({ ...operation })),
      },
    });

    const applied = await prisma.workingRevision.findUniqueOrThrow({ where: { projectId_revision: { projectId: ids.project, revision: 2 } } });
    assert.equal((applied.document as unknown as { dialogues: Array<{ id: string; content: string }> }).dialogues.find((item) => item.id === ids.dialogue)?.content, "新对白");
    assert.deepEqual(applied.assetVersionHeads, { [ids.asset]: ids.assetV1 });
    assert.equal((await prisma.candidate.findUniqueOrThrow({ where: { id: ids.candidate } })).status, CandidateStatus.APPLIED);
    assert.equal((await prisma.candidate.findUniqueOrThrow({ where: { id: ids.sibling } })).status, CandidateStatus.STALE);
    assert.equal((await prisma.storyboardBeat.findUniqueOrThrow({ where: { id: ids.storyboardBeat } })).currentVersionNumber, 1);

    await revertCandidateApplication(ids.user, ids.candidate);
    const reverted = await prisma.workingRevision.findUniqueOrThrow({ where: { projectId_revision: { projectId: ids.project, revision: 3 } } });
    assert.equal((reverted.document as unknown as { dialogues: Array<{ id: string; content: string }> }).dialogues.find((item) => item.id === ids.dialogue)?.content, "旧对白");
    assert.equal((await prisma.storyboardBeat.findUniqueOrThrow({ where: { id: ids.storyboardBeat } })).currentVersionNumber, 1);
    assert.equal((await prisma.candidate.findUniqueOrThrow({ where: { id: ids.candidate } })).status, CandidateStatus.REVERTED);

    await prisma.canvasAssetListItem.create({ data: { ownerUserId: ids.user, projectId: ids.project, assetId: ids.asset, displayName: "测试角色" } });
    const placement = await prisma.canvasReferencePlacement.create({ data: { ownerUserId: ids.user, projectId: ids.project, assetId: ids.asset, assetVersionId: ids.assetV1, x: 120, y: 80 } });
    const archived = await archiveAssetFamily(ids.user, ids.assetVariant);
    assert.equal(archived.id, ids.asset);
    assert.deepEqual(new Set(archived.archivedAssetIds), new Set([ids.asset, ids.assetVariant]));
    assert.equal((await prisma.asset.findUniqueOrThrow({ where: { id: ids.asset } })).archivedAt instanceof Date, true);
    assert.equal((await prisma.asset.findUniqueOrThrow({ where: { id: ids.assetVariant } })).archivedAt instanceof Date, true);
    assert.equal((await prisma.canvasAssetListItem.findUniqueOrThrow({ where: { projectId_assetId: { projectId: ids.project, assetId: ids.asset } } })).hiddenAt instanceof Date, true);
    assert.equal((await prisma.canvasReferencePlacement.findUnique({ where: { id: placement.id } }))?.assetVersionId, ids.assetV1);
    assert.deepEqual(await listComicAssetCards(ids.user, ids.comic), []);
    await assert.rejects(() => getAssetFamilyDetail(ids.user, ids.asset), /资产不存在/);

    const restoredItem = await restoreAssetToCanvasList(ids.user, ids.project, ids.asset);
    assert.equal(restoredItem.assetId, ids.asset);
    assert.equal((await prisma.asset.findUniqueOrThrow({ where: { id: ids.asset } })).archivedAt, null);
    assert.equal((await prisma.asset.findUniqueOrThrow({ where: { id: ids.assetVariant } })).archivedAt, null);
    assert.equal((await prisma.canvasAssetListItem.findUniqueOrThrow({ where: { projectId_assetId: { projectId: ids.project, assetId: ids.asset } } })).hiddenAt, null);
  } finally {
    if (copiedComicId) {
      const copiedProjects = await prisma.project.findMany({ where: { chapter: { comicId: copiedComicId } }, select: { id: true } });
      const copiedProjectIds = copiedProjects.map((project) => project.id);
      await prisma.agentConversation.deleteMany({ where: { projectId: { in: copiedProjectIds } } });
      await prisma.storyboardBeatVersion.deleteMany({ where: { storyboardBeat: { projectId: { in: copiedProjectIds } } } });
      await prisma.storyboardBeat.deleteMany({ where: { projectId: { in: copiedProjectIds } } });
      await prisma.canvasAssetListItem.deleteMany({ where: { projectId: { in: copiedProjectIds } } });
      await prisma.assetImage.deleteMany({ where: { asset: { comicId: copiedComicId } } });
      await prisma.assetVersion.deleteMany({ where: { asset: { comicId: copiedComicId } } });
      await prisma.asset.updateMany({ where: { comicId: copiedComicId }, data: { variantOfAssetId: null } });
      await prisma.asset.deleteMany({ where: { comicId: copiedComicId } });
      await prisma.workingRevision.deleteMany({ where: { projectId: { in: copiedProjectIds } } });
      await prisma.project.deleteMany({ where: { id: { in: copiedProjectIds } } });
      await prisma.chapter.deleteMany({ where: { comicId: copiedComicId } });
      await prisma.comicSetting.deleteMany({ where: { comicId: copiedComicId } });
      await prisma.comic.deleteMany({ where: { id: copiedComicId } });
    }
    await prisma.candidate.deleteMany({ where: { projectId: ids.project } });
    await prisma.generationAttempt.deleteMany({ where: { task: { projectId: ids.project } } });
    await prisma.generationTask.deleteMany({ where: { projectId: ids.project } });
    await prisma.message.deleteMany({ where: { conversationId: ids.conversation } });
    await prisma.agentConversation.deleteMany({ where: { id: ids.conversation } });
    await prisma.storyboardBeatVersion.deleteMany({ where: { storyboardBeat: { projectId: ids.project } } });
    await prisma.storyboardBeat.deleteMany({ where: { projectId: ids.project } });
    await prisma.canvasReferencePlacement.deleteMany({ where: { projectId: ids.project } });
    await prisma.canvasAssetListItem.deleteMany({ where: { projectId: ids.project } });
    await prisma.externalAssetUpload.deleteMany({ where: { asset: { comicId: ids.comic } } });
    await prisma.assetImage.deleteMany({ where: { asset: { comicId: ids.comic } } });
    await prisma.assetVersion.deleteMany({ where: { asset: { comicId: ids.comic } } });
    await prisma.asset.updateMany({ where: { comicId: ids.comic }, data: { variantOfAssetId: null } });
    await prisma.asset.deleteMany({ where: { comicId: ids.comic } });
    await prisma.workingRevision.deleteMany({ where: { projectId: ids.project } });
    await prisma.project.deleteMany({ where: { id: ids.project } });
    await prisma.chapter.deleteMany({ where: { id: ids.chapter } });
    await prisma.comicSetting.deleteMany({ where: { comicId: ids.comic } });
    await prisma.comic.deleteMany({ where: { id: ids.comic } });
    await prisma.externalAgentOperation.deleteMany({ where: { ownerUserId: ids.user } });
    await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.$disconnect();
  }
});

test("local task runner recovers interrupted tasks and preserves canceled tasks in SQLite", async () => {
  await initializeDatabaseConnection();
  const suffix = randomUUID();
  const ids = {
    user: `runner-user-${suffix}`,
    comic: `runner-comic-${suffix}`,
    chapter: `runner-chapter-${suffix}`,
    project: `runner-project-${suffix}`,
    runningTask: `runner-task-running-${suffix}`,
    canceledTask: `runner-task-canceled-${suffix}`,
  };
  const runner = new LocalTaskRunner({ concurrency: 0, pollIntervalMs: 60_000 });
  try {
    await prisma.user.create({ data: { id: ids.user, email: `${suffix}@runner.lantern.local`, displayName: "Task Runner Test" } });
    await prisma.comic.create({ data: { id: ids.comic, ownerUserId: ids.user, title: "Task Runner Test" } });
    await prisma.chapter.create({ data: { id: ids.chapter, ownerUserId: ids.user, comicId: ids.comic, number: 1, title: "Chapter" } });
    await prisma.project.create({ data: { id: ids.project, ownerUserId: ids.user, chapterId: ids.chapter } });
    const taskData = {
      ownerUserId: ids.user,
      projectId: ids.project,
      type: TaskType.STORYBOARD,
      capabilityId: "storyboard.edit_single_entry",
      capabilityVersion: 1,
      baseRevision: 1,
      scope: "selected_comic_frame",
      target: { type: "comic_frame", id: "frame-1" },
      input: { instruction: "test" },
      contextSnapshot: {},
      provider: "test",
      model: "test",
    } as const;
    await prisma.generationTask.create({ data: { ...taskData, id: ids.runningTask, status: TaskStatus.RUNNING, idempotencyKey: `runner:running:${suffix}`, attempts: { create: { attempt: 1, status: TaskStatus.RUNNING } } } });
    await prisma.generationTask.create({ data: { ...taskData, id: ids.canceledTask, status: TaskStatus.CANCELED, idempotencyKey: `runner:canceled:${suffix}` } });

    await runner.start();

    const recovered = await prisma.generationTask.findUniqueOrThrow({ where: { id: ids.runningTask } });
    const canceled = await prisma.generationTask.findUniqueOrThrow({ where: { id: ids.canceledTask } });
    const attempt = await prisma.generationAttempt.findUniqueOrThrow({ where: { taskId_attempt: { taskId: ids.runningTask, attempt: 1 } } });
    assert.equal(recovered.status, TaskStatus.QUEUED);
    assert.equal(recovered.progress, 5);
    assert.equal(canceled.status, TaskStatus.CANCELED);
    assert.equal(attempt.status, TaskStatus.FAILED);
    assert.equal(attempt.errorCode, "runtime_interrupted");
  } finally {
    await runner.stop();
    await prisma.generationAttempt.deleteMany({ where: { taskId: { in: [ids.runningTask, ids.canceledTask] } } });
    await prisma.generationTask.deleteMany({ where: { id: { in: [ids.runningTask, ids.canceledTask] } } });
    await prisma.project.deleteMany({ where: { id: ids.project } });
    await prisma.chapter.deleteMany({ where: { id: ids.chapter } });
    await prisma.comic.deleteMany({ where: { id: ids.comic } });
    await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.$disconnect();
  }
});

test("initial data contains only the built-in example comic", async () => {
  await initializeDatabaseConnection();
  try {
    await seed();
    const comics = await prisma.comic.findMany({
      where: { isExample: true },
      orderBy: { id: "asc" },
      select: { id: true, title: true, summary: true, isExample: true },
    });
    assert.deepEqual(comics, [
      {
        id: "comic-campus-letter",
        title: "风停之前",
        summary: "夏末，夏葵在书包里发现一封没有署名的信。她认出熟悉的五瓣花印，循着信中的约定赶到即将封闭的旧看台——",
        isExample: true,
      },
    ]);
    const [canvasAssets, messages, page3CandidateCount, project] = await Promise.all([
      prisma.canvasAssetListItem.findMany({
        where: { projectId: "project-campus-letter-01", hiddenAt: null },
        orderBy: { sortIndex: "asc" },
        select: { assetId: true },
      }),
      prisma.message.findMany({
        where: { conversationId: "conversation-campus-letter-main" },
        orderBy: { createdAt: "asc" },
        select: { role: true, kind: true, content: true },
      }),
      prisma.candidate.count({ where: { id: "candidate-campus-page3-rhythm" } }),
      prisma.project.findUniqueOrThrow({ where: { id: "project-campus-letter-01" }, select: { workspaceSettings: true } }),
    ]);
    assert.deepEqual(canvasAssets.map((item) => item.assetId), [
      "campus-asset-xiakui",
      "campus-asset-lincheng",
      "campus-asset-cover",
      "campus-asset-title-art",
      "campus-asset-classroom-lesson",
      "campus-asset-breakout-panel",
    ]);
    assert.deepEqual(messages.map((message) => [message.role, message.kind]), [
      ["USER", "PLAIN"],
      ["AGENT", "PLAIN"],
      ["USER", "PLAIN"],
      ["AGENT", "PLAIN"],
    ]);
    assert.match(messages[0].content, /后脚的透视有点大/);
    assert.match(messages[0].content, /最开始原图/);
    assert.match(messages[1].content, /自然的屈膝跑姿/);
    assert.match(messages[2].content, /上一次提交/);
    assert.match(messages[2].content, /背景楼梯/);
    assert.match(messages[2].content, /中心再放大/);
    assert.match(messages[2].content, /往左移动/);
    assert.match(messages[2].content, /尾巴再向右上收短/);
    assert.match(messages[3].content, /肩背侧向/);
    assert.match(messages[3].content, /水泥看台阶梯/);
    assert.match(messages[3].content, /进一步收紧裁切/);
    assert.match(messages[3].content, /向左移动/);
    assert.match(messages[3].content, /尾巴向右上收短/);
    assert.equal(page3CandidateCount, 0);
    assert.deepEqual(project.workspaceSettings, { pageDisplayMode: "spread" });
    const workbench = await getWorkbench("user-local-creator", "chapter-campus-letter-01");
    assert.deepEqual(workbench.project.workspaceSettings, { pageDisplayMode: "spread" });
    assert.deepEqual(workbench.assets.map((asset) => asset.id), canvasAssets.map((item) => item.assetId));
    assert.ok(workbench.messages.every((message) => message.kind === "plain"));
    assert.ok(workbench.candidates.every((candidate) => candidate.id !== "candidate-campus-page3-rhythm"));
  } finally {
    await prisma.$disconnect();
  }
});
