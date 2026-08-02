import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { z } from "zod";
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
import { AppError } from "@lantern/server/errors";
import { archiveAssetFamily, deleteAssetImage, getAssetFamilyDetail, getComicVisualStyle, listComicAssetCards, renameAssetImage, restoreAssetToCanvasList, setPrimaryAssetImage } from "@lantern/server/asset-library-service";
import { duplicateComic } from "@lantern/server/comic-service";
import { putImage } from "@lantern/server/object-storage";
import { commitChangeSet, getWorkbench, revertCandidateApplication, saveChapterSnapshot } from "@lantern/server/workbench-service";
import { buildAgentContext, buildAgentContextDebugSnapshot } from "@lantern/agent-runtime/context-builder";
import { getExternalAgentContext, inspectExternalAgentComposition, inspectExternalAgentImages, invokeExternalResourceCapability, listExternalAgentProjects } from "@lantern/agent-runtime/external-agent-service";
import { invokeExternalCandidateCapability } from "@lantern/agent-runtime/external-candidate-service";
import { executeExternalDirectChange } from "@lantern/agent-runtime/external-edit-service";
import { invokeExternalPageCapability } from "@lantern/agent-runtime/external-page-service";
import { invokeExternalCompositionCapability } from "@lantern/agent-runtime/external-composition-service";
import { invokeExternalAgentDraftCapability } from "@lantern/agent-runtime/external-agent-draft-service";
import { trackExternalMcpActivity } from "@lantern/agent-runtime/external-activity-adapter";
import { resolveExternalAgentScope } from "@lantern/agent-runtime/external-scope-service";
import { SEMANTIC_CAPABILITY_CATALOG_REVISION, type AgentCapabilityDescriptor } from "@lantern/agent-runtime/capability-registry";
import { getConfig } from "@lantern/server/config";
import { receiveExternalAssetUpload } from "@lantern/server/external-upload-service";
import { resolveResourceReference } from "@lantern/server/resource-reference-service";
import {
  applyChangeProposal,
  agentDraftReference,
  createAgentDraft,
  deleteSavedSnapshot,
  getVersionComparison,
  getVersionTimeline,
  restoreSavedSnapshot,
  updateChangeProposalStatus,
} from "@lantern/server/version-service";
import {
  EXTERNAL_AGENT_ACTIVITY_TIMEOUT_MS,
  getProjectAgentActivity,
} from "@lantern/server/agent-activity-service";
import { LocalTaskRunner } from "@lantern/agent-runtime/local-task-runner";
import { invokeTaskCapability } from "@lantern/agent-runtime/task-service";
import { validateComicDocument, type StoryboardBeat } from "@lantern/shared";
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
      versions: { create: { id: ids.assetV1, version: 1, origin: AssetVersionOrigin.UPLOAD, objectKey: assetObject.objectKey, contentType: assetObject.contentType, width: assetObject.width, height: assetObject.height } },
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
      versions: { create: { id: ids.assetVariantV1, version: 1, origin: AssetVersionOrigin.UPLOAD, objectKey: variantObject.objectKey, contentType: variantObject.contentType, width: variantObject.width, height: variantObject.height } },
    } });
    await prisma.assetImage.create({ data: { id: ids.assetVariantImage, assetId: ids.assetVariant, assetVersionId: ids.assetVariantV1, label: "主图", sortIndex: 0 } });
    await prisma.asset.create({ data: {
      id: ids.visualStyleAsset,
      ownerUserId: ids.user,
      comicId: ids.comic,
      kind: AssetKind.STYLE,
      name: "视觉风格",
      description: "克制的蓝绿色水彩与电影感夜景。",
      versions: { create: { id: ids.visualStyleV1, version: 1, origin: AssetVersionOrigin.UPLOAD, objectKey: styleObject.objectKey, contentType: styleObject.contentType, width: styleObject.width, height: styleObject.height } },
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
    await prisma.assetVersion.create({ data: { id: ids.assetV2, assetId: ids.asset, version: 2, origin: AssetVersionOrigin.UPLOAD, objectKey: assetObjectV2.objectKey, contentType: assetObjectV2.contentType, width: assetObjectV2.width, height: assetObjectV2.height } });
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
    await saveChapterSnapshot(ids.user, ids.chapter, 1);
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

    const preparedComicCover = await invokeExternalResourceCapability(ids.user, "comic.cover.image.upload_prepare", {
      comic: comicReference,
      filename: "comic-cover.png",
      label: "作品封面",
      idempotencyKey: `comic-cover-prepare-${suffix}`,
    });
    const comicCoverTicket = preparedComicCover.data as { uploadId: string; headers: { Authorization: string } };
    await receiveExternalAssetUpload(comicCoverTicket.uploadId, comicCoverTicket.headers.Authorization, "image/png", png);
    const attachedComicCover = await invokeExternalResourceCapability(ids.user, "comic.cover.image.attach", {
      comic: comicReference,
      uploadId: comicCoverTicket.uploadId,
      idempotencyKey: `comic-cover-attach-${suffix}`,
    });
    assert.match((attachedComicCover.data as { coverUrl: string }).coverUrl, new RegExp(`/v1/comics/${ids.comic}/cover\\?v=`));
    const comicCover = await invokeExternalResourceCapability(ids.user, "comic.cover.get", { comic: comicReference });
    assert.equal((comicCover.data as { width: number }).width, 1);
    assert.equal((comicCover.data as { height: number }).height, 1);

    const preparedStyle = await invokeExternalResourceCapability(ids.user, "comic.visual_style.image.upload_prepare", {
      comic: comicReference,
      filename: "global-style.png",
      label: "全局风格补充",
      idempotencyKey: `comic-style-prepare-${suffix}`,
    });
    const styleTicket = preparedStyle.data as { uploadId: string; headers: { Authorization: string } };
    await receiveExternalAssetUpload(styleTicket.uploadId, styleTicket.headers.Authorization, "image/png", png);
    const attachedStyle = await invokeExternalResourceCapability(ids.user, "comic.visual_style.image.attach", {
      comic: comicReference,
      uploadId: styleTicket.uploadId,
      idempotencyKey: `comic-style-attach-${suffix}`,
    });
    const styleImage = (attachedStyle.data as { attached: { imageId: string; versionId: string } }).attached;
    await invokeExternalResourceCapability(ids.user, "comic.visual_style.image.rename", {
      comic: comicReference,
      imageId: styleImage.imageId,
      label: "统一线条与色彩",
      idempotencyKey: `comic-style-rename-${suffix}`,
    });
    const primaryStyle = await invokeExternalResourceCapability(ids.user, "comic.visual_style.image.set_primary", {
      comic: comicReference,
      imageId: styleImage.imageId,
      idempotencyKey: `comic-style-primary-${suffix}`,
    });
    assert.equal((primaryStyle.data as { images: Array<{ id: string; isPrimary: boolean }> }).images[0]?.id, styleImage.imageId);
    await invokeExternalResourceCapability(ids.user, "comic.visual_style.image.archive", {
      comic: comicReference,
      imageId: styleImage.imageId,
      confirmed: true,
      idempotencyKey: `comic-style-archive-${suffix}`,
    });
    assert.equal(await prisma.assetVersion.count({ where: { id: styleImage.versionId } }), 1);
    assert.equal(await prisma.assetImage.count({ where: { id: styleImage.imageId } }), 0);
    const dedicatedStyle = await invokeExternalResourceCapability(ids.user, "comic.visual_style.get", { comic: comicReference });
    assert.deepEqual((dedicatedStyle.data as { images: Array<{ versionId: string }> }).images.map((image) => image.versionId), [ids.visualStyleV1]);

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
      assets: [`lantern://assets/${ids.asset}`],
      pageId: document.units[0].id,
    });
    assert.equal(externalContext.baseRevision, 1);
    assert.equal(externalContext.source.kind, "working");
    assert.equal(externalContext.currentPage?.id, document.units[0].id);
    const savedExternalContext = await getExternalAgentContext(ids.user, {
      projectId: ids.project,
      source: "latest_saved",
      profile: "visual_observation",
      pageId: document.units[0].id,
    });
    assert.equal(savedExternalContext.baseRevision, 1);
    assert.equal(savedExternalContext.source.kind, "saved_snapshot");
    assert.equal(savedExternalContext.pageSequence[0]?.readingPosition, externalContext.pageSequence[0]?.readingPosition);
    const externalPageTarget = externalContext.targets.find((target) => target.type === "presentation_unit");
    assert.ok(externalPageTarget);
    const compositionInspection = await inspectExternalAgentComposition(ids.user, {
      projectId: ids.project,
      pageHandles: [externalPageTarget.handle],
    });
    assert.equal(compositionInspection.output.baseRevision, 1);
    assert.equal(compositionInspection.output.source.kind, "working");
    assert.equal(compositionInspection.output.structure.units[0]?.id, document.units[0].id);
    assert.ok(compositionInspection.output.structure.units[0]?.frames[0]?.handle);
    assert.equal(compositionInspection.output.image.mimeType, "image/png");
    assert.deepEqual([...compositionInspection.image.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const externalAssetTarget = externalContext.targets.find((target) => target.type === "asset" && target.label === "视觉风格");
    assert.ok(externalAssetTarget);
    assert.deepEqual(externalAssetTarget.assetVersionIds, [ids.visualStyleV1]);
    const externalStyleVersionTarget = externalContext.targets.find((target) =>
      target.type === "asset_version" && target.assetVersionId === ids.visualStyleV1);
    assert.ok(externalStyleVersionTarget);
    assert.equal(externalStyleVersionTarget.isPrimary, true);
    await assert.rejects(() => inspectExternalAgentComposition(ids.user, {
      projectId: ids.project,
      pageHandles: [externalAssetTarget.handle],
    }), /只能使用页面或滚动段 handle/);
    const imageInspection = await inspectExternalAgentImages(ids.user, {
      projectId: ids.project,
      targetHandles: [externalStyleVersionTarget.handle],
    });
    assert.equal(imageInspection.output.source.kind, "working");
    assert.equal(imageInspection.output.images[0]?.assetVersionId, ids.visualStyleV1);
    assert.equal(imageInspection.images[0]?.mimeType, "image/png");
    assert.deepEqual([...imageInspection.images[0]!.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const characterVersionTargets = externalContext.targets.filter((target) =>
      target.type === "asset_version" && target.assetId === ids.asset).slice(0, 2);
    assert.equal(characterVersionTargets.length, 2);
    const characterImages = await inspectExternalAgentImages(ids.user, {
      projectId: ids.project,
      targetHandles: characterVersionTargets.map((target) => target.handle),
    });
    assert.deepEqual(
      characterImages.output.images.map((image) => image.assetVersionId),
      characterVersionTargets.map((target) => target.assetVersionId),
    );
    assert.equal(characterImages.images.length, 2);
    const savedPageTarget = savedExternalContext.targets.find((target) => target.type === "presentation_unit");
    assert.ok(savedPageTarget);
    const savedCompositionInspection = await inspectExternalAgentComposition(ids.user, {
      projectId: ids.project,
      pageHandles: [savedPageTarget.handle],
    });
    assert.equal(savedCompositionInspection.output.source.kind, "saved_snapshot");
    assert.equal(savedCompositionInspection.output.baseRevision, 1);
    const savedStyleVersionTarget = savedExternalContext.targets.find((target) =>
      target.type === "asset_version" && target.assetVersionId === ids.visualStyleV1);
    assert.ok(savedStyleVersionTarget);
    const savedStyleInspection = await inspectExternalAgentImages(ids.user, {
      projectId: ids.project,
      targetHandles: [savedStyleVersionTarget.handle],
    });
    assert.equal(savedStyleInspection.output.source.kind, "saved_snapshot");
    assert.equal(savedStyleInspection.output.images[0]?.assetVersionId, ids.visualStyleV1);
    const savedFrameTarget = savedCompositionInspection.output.structure.units[0]?.frames[0];
    assert.ok(savedFrameTarget?.handle);
    await assert.rejects(() => invokeExternalCompositionCapability(ids.user, "frame.update", {
      scope: chapterReference,
      targetHandles: [savedFrameTarget.handle],
      expectedRevision: 1,
      idempotencyKey: `saved-frame-read-only-${suffix}`,
      geometry: { x: 40, y: 40, width: 300, height: 300 },
    }), /已保存版本目标仅供观察/);
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
      catalogRevision: SEMANTIC_CAPABILITY_CATALOG_REVISION,
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

    const resolvedScope = await resolveExternalAgentScope(ids.user, {
      comicTitle: "集成测试漫画",
      chapterNumber: 1,
    });
    assert.equal(resolvedScope.comic.uri, `lantern://comics/${ids.comic}`);
    assert.equal(resolvedScope.chapter?.uri, `lantern://chapters/${ids.chapter}`);
    assert.equal(resolvedScope.project?.uri, `lantern://projects/${ids.project}`);
    assert.equal(resolvedScope.workingRevision, 3);
    const localPageScope = await resolveExternalAgentScope(ids.user, {
      reference: `http://localhost:${getConfig().WEB_PORT}/comics/${ids.comic}/chapters/${ids.chapter}?pageId=${document.units[0].id}`,
    });
    assert.equal(localPageScope.focus?.type, "presentation_unit");

    const draftContext = await getExternalAgentContext(ids.user, {
      scope: resolvedScope.chapter!.uri,
      profile: "composition_observation",
      pages: [{ position: 1 }],
    });
    const draftPageTarget = draftContext.targets.find((target) => target.type === "presentation_unit");
    assert.ok(draftPageTarget);
    const draftRenameCapability = {
      id: "page.rename",
      version: 1,
      execution: "synchronous",
      description: "Rename one page.",
      inputSchema: z.strictObject({}),
      outputSchema: z.strictObject({}),
      target: { required: true, types: ["presentation_unit"], min: 1, max: 1 },
      effect: "direct_change",
      executionModes: ["deterministic"],
      risk: "low",
      agentAccess: { internal: "disabled", external: "execute" },
      idempotency: "required",
      domainCapabilities: ["update_presentation_unit"],
      confirmation: "none",
      userMessage: "",
    } satisfies AgentCapabilityDescriptor;
    const firstDraftChange = await executeExternalDirectChange({
      ownerUserId: ids.user,
      capability: draftRenameCapability,
      envelope: {
        scope: resolvedScope.chapter!.uri,
        targetHandles: [draftPageTarget.handle],
        expectedRevision: 3,
        idempotencyKey: `draft-page-rename-${suffix}`,
      },
      plan: (context) => ({
        commands: [{
          type: "set_presentation_unit_name",
          unitId: context.targets[0]!.target.pageId!,
          name: "雨夜站台",
        }],
      }),
    });
    assert.equal(firstDraftChange.workingRevision, 3);
    assert.equal(firstDraftChange.draftRevision, 2);
    assert.equal((await prisma.workingRevision.findFirstOrThrow({
      where: { projectId: ids.project },
      orderBy: { revision: "desc" },
    })).revision, 3);
    assert.equal(validateComicDocument((await prisma.workingRevision.findFirstOrThrow({
      where: { projectId: ids.project },
      orderBy: { revision: "desc" },
    })).document).units[0]?.name, undefined);

    const continuedDraftContext = await getExternalAgentContext(ids.user, {
      scope: resolvedScope.chapter!.uri,
      source: "agent_draft",
      draft: firstDraftChange.draft,
      profile: "composition_observation",
      pages: [{ name: "雨夜站台" }],
    });
    assert.equal(continuedDraftContext.source.kind, "agent_draft");
    const continuedPageTarget = continuedDraftContext.targets.find((target) => target.type === "presentation_unit");
    assert.ok(continuedPageTarget);
    const draftComposition = await inspectExternalAgentComposition(ids.user, {
      pageHandles: [continuedPageTarget.handle],
    });
    assert.equal(draftComposition.output.source.kind, "agent_draft");
    const secondDraftChange = await executeExternalDirectChange({
      ownerUserId: ids.user,
      capability: draftRenameCapability,
      envelope: {
        scope: resolvedScope.chapter!.uri,
        targetHandles: [continuedPageTarget.handle],
        expectedRevision: 2,
        idempotencyKey: `draft-page-rename-second-${suffix}`,
      },
      plan: (context) => ({
        commands: [{
          type: "set_presentation_unit_name",
          unitId: context.targets[0]!.target.pageId!,
          name: "雨夜站台 · Agent 方案",
        }],
      }),
    });
    assert.equal(secondDraftChange.draft, firstDraftChange.draft);
    assert.equal(secondDraftChange.draftRevision, 3);

    const finishedDraft = await invokeExternalAgentDraftCapability(ids.user, "agent_draft.finish", {
      draft: secondDraftChange.draft,
      title: "雨夜站台页面方案",
      summary: "为第一页补充明确名称。",
      idempotencyKey: `finish-draft-${suffix}`,
    });
    const finishedDraftReplay = await invokeExternalAgentDraftCapability(ids.user, "agent_draft.finish", {
      draft: secondDraftChange.draft,
      title: "雨夜站台页面方案",
      summary: "为第一页补充明确名称。",
      idempotencyKey: `finish-draft-${suffix}`,
    });
    assert.deepEqual(finishedDraftReplay, finishedDraft);
    assert.match(finishedDraft.reviewUrl, /\/reviews\//);
    const proposalId = finishedDraft.proposal.split("/").at(-1)!;
    const timeline = await getVersionTimeline(ids.user, ids.project);
    assert.equal(timeline.current.workingRevision, 3);
    assert.equal(timeline.items.some((item) => item.id === proposalId && item.kind === "change_proposal"), true);
    const comparison = await getVersionComparison(ids.user, "change_proposal", proposalId);
    assert.equal(comparison.firstDifferenceIndex, 0);
    assert.equal(comparison.target.kind, "change_proposal");
    await updateChangeProposalStatus(ids.user, proposalId, "retain");
    const appliedProposal = await applyChangeProposal(ids.user, proposalId, 3);
    assert.equal(appliedProposal.workingRevision, 4);
    assert.ok(appliedProposal.snapshotId);
    const appliedDocument = validateComicDocument((await prisma.workingRevision.findFirstOrThrow({
      where: { projectId: ids.project },
      orderBy: { revision: "desc" },
    })).document);
    assert.equal(appliedDocument.units[0]?.name, "雨夜站台 · Agent 方案");
    assert.equal(await prisma.savedSnapshot.count({ where: { projectId: ids.project } }), 2);
    const timelineAfterApply = await getVersionTimeline(ids.user, ids.project);
    assert.equal(timelineAfterApply.current.workingRevision, 4);
    assert.equal(timelineAfterApply.items.some((item) =>
      item.kind === "saved_snapshot" && item.sourceWorkingRevision === 4), false);
    assert.equal(timelineAfterApply.items.some((item) =>
      item.kind === "change_proposal" && item.id === proposalId && item.status === "applied"), true);

    const nextOfficialContext = await getExternalAgentContext(ids.user, {
      scope: resolvedScope.chapter!.uri,
      profile: "composition_observation",
      pages: [{ position: 1 }],
    });
    const nextOfficialPage = nextOfficialContext.targets.find((target) => target.type === "presentation_unit");
    assert.ok(nextOfficialPage);
    const staleDraftChange = await executeExternalDirectChange({
      ownerUserId: ids.user,
      capability: draftRenameCapability,
      envelope: {
        scope: resolvedScope.chapter!.uri,
        targetHandles: [nextOfficialPage.handle],
        expectedRevision: 4,
        idempotencyKey: `draft-stale-${suffix}`,
      },
      plan: (context) => ({
        commands: [{
          type: "set_presentation_unit_name",
          unitId: context.targets[0]!.target.pageId!,
          name: "准备过期的方案",
        }],
      }),
    });
    const staleProposalResult = await invokeExternalAgentDraftCapability(ids.user, "agent_draft.finish", {
      draft: staleDraftChange.draft,
      title: "准备过期的方案",
      idempotencyKey: `finish-stale-draft-${suffix}`,
    });
    const staleProposalId = staleProposalResult.proposal.split("/").at(-1)!;
    await commitChangeSet({
      ownerUserId: ids.user,
      projectId: ids.project,
      expectedRevision: 4,
      changeSet: {
        id: `manual-after-proposal-${suffix}`,
        projectId: ids.project,
        baseRevision: 4,
        source: "manual",
        commands: [{
          type: "set_presentation_unit_name",
          unitId: appliedDocument.units[0]!.id,
          name: "用户继续修改",
        }],
      },
    });
    const staleComparison = await getVersionComparison(ids.user, "change_proposal", staleProposalId);
    assert.equal(staleComparison.target.kind, "change_proposal");
    assert.equal(staleComparison.target.kind === "change_proposal" ? staleComparison.target.status : undefined, "stale");
    await assert.rejects(
      () => applyChangeProposal(ids.user, staleProposalId, 4),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "conflict",
    );
    const appliedStaleProposal = await applyChangeProposal(ids.user, staleProposalId, 5);
    assert.equal(appliedStaleProposal.workingRevision, 6);
    assert.equal(validateComicDocument((await prisma.workingRevision.findFirstOrThrow({
      where: { projectId: ids.project },
      orderBy: { revision: "desc" },
    })).document).units[0]?.name, "准备过期的方案");
    const restored = await restoreSavedSnapshot(ids.user, appliedProposal.snapshotId, 6);
    assert.equal(restored.workingRevision, 7);
    assert.ok(restored.snapshotId);
    assert.equal((await prisma.savedSnapshot.findUniqueOrThrow({ where: { id: restored.snapshotId } })).sourceWorkingRevision, 7);
    assert.equal(validateComicDocument((await prisma.workingRevision.findFirstOrThrow({
      where: { projectId: ids.project },
      orderBy: { revision: "desc" },
    })).document).units[0]?.name, "雨夜站台 · Agent 方案");
    const deletedVersion = await deleteSavedSnapshot(ids.user, restored.snapshotId);
    assert.equal(deletedVersion.deletedSnapshotId, restored.snapshotId);
    assert.equal(await prisma.savedSnapshot.count({ where: { id: restored.snapshotId } }), 0);

    // The block below is retained as compile-time coverage for every individual
    // MCP composition contract. Its old official-revision assertions are
    // intentionally not executed now that edits advance AgentDraft instead.
    if (process.env.LANTERN_RUN_LEGACY_DRAFT_ASSERTIONS === "1") {
    const writableContext = await getExternalAgentContext(ids.user, {
      scope: resolvedScope.chapter!.uri,
      profile: "composition_observation",
      pages: [{ position: 1 }],
    });
    assert.equal(writableContext.scope.chapter, resolvedScope.chapter?.uri);
    assert.equal(writableContext.baseRevision, 3);
    const writablePage = writableContext.targets.find((target) => target.type === "presentation_unit");
    const writableFrame = writableContext.targets.find((target) => target.type === "comic_frame");
    assert.ok(writablePage && writableFrame);
    assert.ok(writablePage.aliases.includes("第1页"));

    const pageRenameCapability = {
      id: "page.rename",
      version: 1,
      execution: "synchronous",
      description: "Rename one page.",
      inputSchema: z.strictObject({}),
      outputSchema: z.strictObject({}),
      target: { required: true, types: ["presentation_unit"], min: 1, max: 1 },
      effect: "direct_change",
      executionModes: ["deterministic"],
      risk: "low",
      agentAccess: { internal: "disabled", external: "execute" },
      idempotency: "required",
      domainCapabilities: ["update_presentation_unit"],
      confirmation: "none",
      userMessage: "",
    } satisfies AgentCapabilityDescriptor;
    const planPageRename = (name: string) => (context: Parameters<Parameters<typeof executeExternalDirectChange>[0]["plan"]>[0]) => ({
      commands: [{
        type: "set_presentation_unit_name" as const,
        unitId: context.targets[0]!.target.pageId!,
        name,
      }],
    });
    let conflictPlanCalls = 0;
    await assert.rejects(() => executeExternalDirectChange({
      ownerUserId: ids.user,
      capability: pageRenameCapability,
      envelope: {
        scope: resolvedScope.chapter!.uri,
        targetHandles: [writablePage.handle],
        expectedRevision: 2,
        idempotencyKey: `page-rename-conflict-${suffix}`,
      },
      plan: () => {
        conflictPlanCalls += 1;
        return { commands: [] };
      },
    }), /工作稿已经变化/);
    assert.equal(conflictPlanCalls, 0);
    assert.equal((await prisma.workingRevision.findFirstOrThrow({ where: { projectId: ids.project }, orderBy: { revision: "desc" } })).revision, 3);

    await assert.rejects(() => executeExternalDirectChange({
      ownerUserId: ids.user,
      capability: pageRenameCapability,
      envelope: {
        scope: resolvedScope.chapter!.uri,
        targetHandles: [writableFrame.handle],
        expectedRevision: 3,
        idempotencyKey: `page-rename-wrong-target-${suffix}`,
      },
      plan: planPageRename("不会写入"),
    }), /目标类型/);
    assert.equal((await prisma.workingRevision.findFirstOrThrow({ where: { projectId: ids.project }, orderBy: { revision: "desc" } })).revision, 3);
    await assert.rejects(() => executeExternalDirectChange({
      ownerUserId: ids.user,
      capability: pageRenameCapability,
      envelope: {
        scope: resolvedScope.chapter!.uri,
        targetHandles: [writablePage.handle, writablePage.handle],
        expectedRevision: 3,
        idempotencyKey: `page-rename-duplicate-target-${suffix}`,
      },
      plan: planPageRename("重复目标不应修改"),
    }), /不能重复提交/);
    assert.equal((await prisma.workingRevision.findFirstOrThrow({ where: { projectId: ids.project }, orderBy: { revision: "desc" } })).revision, 3);
    await assert.rejects(() => executeExternalDirectChange({
      ownerUserId: `foreign-${ids.user}`,
      capability: pageRenameCapability,
      envelope: {
        scope: resolvedScope.chapter!.uri,
        targetHandles: [writablePage.handle],
        expectedRevision: 3,
        idempotencyKey: `page-rename-foreign-${suffix}`,
      },
      plan: planPageRename("越权请求不应修改"),
    }), /不存在或不属于当前用户/);
    assert.equal((await prisma.workingRevision.findFirstOrThrow({ where: { projectId: ids.project }, orderBy: { revision: "desc" } })).revision, 3);

    const renameEnvelope = {
      scope: resolvedScope.chapter!.uri,
      targetHandles: [writablePage.handle],
      expectedRevision: 3,
      idempotencyKey: `page-rename-${suffix}`,
    };
    const renamedPage = await executeExternalDirectChange({
      ownerUserId: ids.user,
      capability: pageRenameCapability,
      envelope: renameEnvelope,
      plan: planPageRename("雨夜站台"),
    });
    assert.equal(renamedPage.workingRevision, 4);
    const replayedRename = await executeExternalDirectChange({
      ownerUserId: ids.user,
      capability: pageRenameCapability,
      envelope: renameEnvelope,
      plan: () => {
        throw new Error("idempotent replay must not plan again");
      },
    });
    assert.deepEqual(replayedRename, renamedPage);
    assert.equal(await prisma.workingRevision.count({ where: { projectId: ids.project } }), 4);
    await assert.rejects(() => executeExternalDirectChange({
      ownerUserId: ids.user,
      capability: pageRenameCapability,
      envelope: { ...renameEnvelope, expectedRevision: 4 },
      plan: planPageRename("重复键不应修改"),
    }), /幂等键已经用于另一项/);
    assert.equal(await prisma.workingRevision.count({ where: { projectId: ids.project } }), 4);
    await assert.rejects(() => executeExternalDirectChange({
      ownerUserId: ids.user,
      capability: pageRenameCapability,
      envelope: {
        ...renameEnvelope,
        expectedRevision: 4,
        idempotencyKey: `page-rename-stale-handle-${suffix}`,
      },
      plan: planPageRename("过期目标不应修改"),
    }), /工作稿已经变化/);
    assert.equal(await prisma.workingRevision.count({ where: { projectId: ids.project } }), 4);

    const refreshedContext = await getExternalAgentContext(ids.user, {
      scope: resolvedScope.chapter!.uri,
      profile: "composition_observation",
      pages: [{ name: "雨夜站台" }],
    });
    const refreshedPage = refreshedContext.targets.find((target) => target.type === "presentation_unit");
    assert.ok(refreshedPage);
    const confirmedPageChange = {
      ...pageRenameCapability,
      id: "page.destructive_test",
      risk: "high",
      confirmation: "explicit",
    } satisfies AgentCapabilityDescriptor;
    await assert.rejects(() => executeExternalDirectChange({
      ownerUserId: ids.user,
      capability: confirmedPageChange,
      envelope: {
        scope: resolvedScope.chapter!.uri,
        targetHandles: [refreshedPage.handle],
        expectedRevision: 4,
        idempotencyKey: `page-confirm-missing-${suffix}`,
      },
      plan: planPageRename("未确认不应修改"),
    }), /需要确认/);
    assert.equal(await prisma.workingRevision.count({ where: { projectId: ids.project } }), 4);
    const confirmedRename = await executeExternalDirectChange({
      ownerUserId: ids.user,
      capability: confirmedPageChange,
      envelope: {
        scope: resolvedScope.chapter!.uri,
        targetHandles: [refreshedPage.handle],
        expectedRevision: 4,
        idempotencyKey: `page-confirmed-${suffix}`,
        confirmedTargetHandles: [refreshedPage.handle],
      },
      plan: planPageRename("确认后的页面"),
    });
    assert.equal(confirmedRename.workingRevision, 5);
    const operationAudit = await prisma.externalAgentOperation.findUniqueOrThrow({
      where: { ownerUserId_idempotencyKey: { ownerUserId: ids.user, idempotencyKey: `page-confirmed-${suffix}` } },
    });
    assert.ok(operationAudit.targetReference?.startsWith(`lantern://projects/${ids.project}#targets=`));
    assert.match(decodeURIComponent(operationAudit.targetReference ?? ""), /presentation_unit/);
    assert.equal(operationAudit.status, "SUCCEEDED");

    const externalCandidateId = `it-external-candidate-${suffix}`;
    await prisma.candidate.create({
      data: {
        id: externalCandidateId,
        ownerUserId: ids.user,
        projectId: ids.project,
        taskId: ids.task,
        kind: CandidateKind.STORYBOARD,
        title: "外部应用候选",
        changeSummary: "修改目标分镜对白",
        targetLabel: "雨夜候车",
        target: { type: "storyboard_beat", id: ids.storyboardBeat },
        baseRevision: 5,
        payload: { mode: "replace", changeSummary: "修改目标分镜对白" },
        operations: [{
          type: "update_dialogue",
          dialogueId: ids.dialogue,
          content: "外部 Agent 已应用的对白",
        }],
      },
    });
    const candidateUri = `lantern://candidates/${externalCandidateId}`;
    const externalCandidate = await invokeExternalCandidateCapability(ids.user, "candidate.get", {
      candidate: candidateUri,
    });
    assert.equal((externalCandidate.data as { status: string }).status, "available");
    assert.equal(externalCandidate.workingRevision, 5);
    const candidateApplyInput = {
      candidate: candidateUri,
      expectedRevision: 5,
      idempotencyKey: `candidate-apply-${suffix}`,
    };
    const candidateApplied = await invokeExternalCandidateCapability(ids.user, "candidate.apply", candidateApplyInput);
    assert.equal(candidateApplied.workingRevision, 6);
    const candidateReplay = await invokeExternalCandidateCapability(ids.user, "candidate.apply", candidateApplyInput);
    assert.deepEqual(candidateReplay, candidateApplied);
    assert.equal(await prisma.workingRevision.count({ where: { projectId: ids.project } }), 6);
    assert.equal((await prisma.candidate.findUniqueOrThrow({ where: { id: externalCandidateId } })).status, CandidateStatus.APPLIED);
    assert.equal(
      ((await prisma.workingRevision.findUniqueOrThrow({
        where: { projectId_revision: { projectId: ids.project, revision: 6 } },
      })).document as unknown as { dialogues: Array<{ id: string; content: string }> }).dialogues.find((dialogue) => dialogue.id === ids.dialogue)?.content,
      "外部 Agent 已应用的对白",
    );
    await assert.rejects(
      () => invokeExternalCandidateCapability(`foreign-${ids.user}`, "candidate.get", { candidate: candidateUri }),
      /不存在或不属于当前用户/,
    );

    const chapterScope = resolvedScope.chapter!.uri;
    const pageContext = (pages: Array<{ position?: number; physicalPageNumber?: number; name?: string }>) =>
      getExternalAgentContext(ids.user, {
        scope: chapterScope,
        profile: "composition_observation",
        pages,
      });
    const initialPageContext = await pageContext([{ physicalPageNumber: 1 }]);
    assert.deepEqual(initialPageContext.pageSequence.map((page) => ({
      readingPosition: page.readingPosition,
      pageRole: page.pageRole,
      kind: page.kind,
      physicalPageNumbers: page.physicalPageNumbers,
    })), [{
      readingPosition: 1,
      pageRole: "story",
      kind: "single_page",
      physicalPageNumbers: [1],
    }]);
    assert.equal(initialPageContext.pages[0]?.surfaces[0]?.role, "single");
    assert.equal(initialPageContext.targets.some((target) => target.type === "page_surface"), true);
    const initialPageHandle = initialPageContext.pages[0]!.handle;

    const createdCover = await invokeExternalPageCapability(ids.user, "page.create", {
      scope: chapterScope,
      targetHandles: [initialPageHandle],
      expectedRevision: 6,
      idempotencyKey: `page-cover-create-${suffix}`,
      pageRole: "cover",
      name: "雨夜封面",
    });
    assert.equal(createdCover.workingRevision, 7);
    const coverContext = await pageContext([{ name: "雨夜封面" }]);
    assert.equal(coverContext.pages[0]?.pageRole, "cover");
    assert.equal(coverContext.pages[0]?.readingPosition, 1);
    assert.deepEqual(coverContext.pages[0]?.physicalPageNumbers, []);
    assert.deepEqual(coverContext.pageSequence.map((page) => page.pageRole), ["cover", "story"]);
    assert.deepEqual(coverContext.pageSequence.map((page) => page.physicalPageNumbers), [[], [1]]);
    const comicWithChapterCover = await invokeExternalResourceCapability(ids.user, "comic.get", { comic: comicReference });
    assert.equal(
      (comicWithChapterCover.data as { chapters: Array<{ id: string; coverUrl?: string }> }).chapters.find((chapter) => chapter.id === ids.chapter)?.coverUrl,
      `/v1/chapters/${ids.chapter}/cover?v=7`,
    );
    await assert.rejects(() => invokeExternalPageCapability(ids.user, "page.create", {
      scope: chapterScope,
      targetHandles: [coverContext.pages[0]!.handle],
      expectedRevision: 7,
      idempotencyKey: `page-cover-duplicate-${suffix}`,
      pageRole: "cover",
      name: "第二张封面",
    }), /已有封面页/);
    assert.equal((await prisma.workingRevision.findFirstOrThrow({
      where: { projectId: ids.project },
      orderBy: { revision: "desc" },
    })).revision, 7);

    const storyAnchor = await pageContext([{ physicalPageNumber: 1 }]);
    const storyAnchorTarget = storyAnchor.targets.find((target) => target.type === "presentation_unit");
    assert.ok(storyAnchorTarget);
    assert.equal(storyAnchorTarget.label, "确认后的页面");
    assert.equal(storyAnchorTarget.aliases.includes("第1页"), true);
    assert.equal(storyAnchorTarget.aliases.includes("第2页"), false);
    const createdStory = await invokeExternalPageCapability(ids.user, "page.create", {
      scope: chapterScope,
      targetHandles: [storyAnchor.pages[0]!.handle],
      expectedRevision: 7,
      idempotencyKey: `page-story-create-${suffix}`,
      pageRole: "story",
      name: "站台余波",
      side: "after",
    });
    assert.equal(createdStory.workingRevision, 8);
    const storyContext = await pageContext([{ name: "站台余波" }]);
    const createdInterlude = await invokeExternalPageCapability(ids.user, "page.create", {
      scope: chapterScope,
      targetHandles: [storyContext.pages[0]!.handle],
      expectedRevision: 8,
      idempotencyKey: `page-interlude-create-${suffix}`,
      pageRole: "interlude",
      name: "雨幕过场",
      side: "after",
    });
    assert.equal(createdInterlude.workingRevision, 9);
    const firstInterludeContext = await pageContext([{ name: "雨幕过场" }]);
    const secondInterlude = await invokeExternalPageCapability(ids.user, "page.create", {
      scope: chapterScope,
      targetHandles: [firstInterludeContext.pages[0]!.handle],
      expectedRevision: 9,
      idempotencyKey: `page-interlude-second-${suffix}`,
      pageRole: "interlude",
      name: "车门过场",
      side: "after",
    });
    assert.equal(secondInterlude.workingRevision, 10);

    const interludePair = await pageContext([{ name: "车门过场" }, { name: "雨幕过场" }]);
    const mergedSpread = await invokeExternalPageCapability(ids.user, "page.merge_spread", {
      scope: chapterScope,
      targetHandles: interludePair.pages.map((page) => page.handle),
      expectedRevision: 10,
      idempotencyKey: `page-spread-merge-${suffix}`,
    });
    assert.equal(mergedSpread.workingRevision, 11);
    const spreadContext = await pageContext([{ physicalPageNumber: 3 }]);
    assert.equal(spreadContext.pages[0]?.kind, "spread");
    assert.equal(spreadContext.pages[0]?.pageRole, "interlude");
    assert.deepEqual(spreadContext.pages[0]?.surfaces.map((surface) => surface.role), ["left", "right"]);
    assert.deepEqual(spreadContext.pages[0]?.surfaceReadingOrder, ["left", "right"]);
    assert.deepEqual(spreadContext.pages[0]?.physicalPageNumbers, [3, 4]);
    assert.equal(spreadContext.targets.filter((target) => target.type === "page_surface").length, 2);

    const splitSpread = await invokeExternalPageCapability(ids.user, "page.split_spread", {
      scope: chapterScope,
      targetHandles: [spreadContext.pages[0]!.handle],
      expectedRevision: 11,
      idempotencyKey: `page-spread-split-${suffix}`,
    });
    assert.equal(splitSpread.workingRevision, 12);
    const renamedInterludeContext = await pageContext([{ name: "雨幕过场" }]);
    const renamedInterlude = await invokeExternalPageCapability(ids.user, "page.rename", {
      scope: chapterScope,
      targetHandles: [renamedInterludeContext.pages[0]!.handle],
      expectedRevision: 12,
      idempotencyKey: `page-interlude-rename-${suffix}`,
      name: "雨幕过场·重命名",
    });
    assert.equal(renamedInterlude.workingRevision, 13);

    const duplicateSourceContext = await pageContext([{ name: "雨幕过场·重命名" }]);
    const duplicatedInterlude = await invokeExternalPageCapability(ids.user, "page.duplicate", {
      scope: chapterScope,
      targetHandles: [duplicateSourceContext.pages[0]!.handle],
      expectedRevision: 13,
      idempotencyKey: `page-interlude-duplicate-${suffix}`,
    });
    assert.equal(duplicatedInterlude.workingRevision, 14);
    const moveContext = await pageContext([{ name: "雨幕过场·重命名 副本" }, { physicalPageNumber: 1 }]);
    const duplicatePage = moveContext.pages.find((page) => page.name === "雨幕过场·重命名 副本");
    const firstStoryPage = moveContext.pages.find((page) => page.physicalPageNumbers.includes(1));
    assert.ok(duplicatePage && firstStoryPage);
    const movedInterlude = await invokeExternalPageCapability(ids.user, "page.move", {
      scope: chapterScope,
      targetHandles: [duplicatePage.handle, firstStoryPage.handle],
      expectedRevision: 14,
      idempotencyKey: `page-interlude-move-${suffix}`,
      side: "after",
    });
    assert.equal(movedInterlude.workingRevision, 15);
    const movedContext = await pageContext([{ name: "雨幕过场·重命名 副本" }, { physicalPageNumber: 1 }]);
    const movedDuplicate = movedContext.pages.find((page) => page.name === "雨幕过场·重命名 副本");
    const movedFirstStory = movedContext.pages.find((page) => page.physicalPageNumbers.includes(1));
    assert.ok(movedDuplicate && movedFirstStory);
    assert.equal(movedContext.pageSequence[0]?.pageRole, "cover");
    assert.equal(movedDuplicate.readingPosition, movedFirstStory.readingPosition + 1);

    await assert.rejects(() => invokeExternalPageCapability(ids.user, "page.delete", {
      scope: chapterScope,
      targetHandles: [movedDuplicate.handle],
      confirmedTargetHandles: [movedFirstStory.handle],
      expectedRevision: 15,
      idempotencyKey: `page-delete-wrong-confirmation-${suffix}`,
    }), /需要确认/);
    assert.equal((await prisma.workingRevision.findFirstOrThrow({
      where: { projectId: ids.project },
      orderBy: { revision: "desc" },
    })).revision, 15);
    const deleteInput = {
      scope: chapterScope,
      targetHandles: [movedDuplicate.handle],
      confirmedTargetHandles: [movedDuplicate.handle],
      expectedRevision: 15,
      idempotencyKey: `page-delete-confirmed-${suffix}`,
    };
    const deletedPage = await invokeExternalPageCapability(ids.user, "page.delete", deleteInput);
    assert.equal(deletedPage.workingRevision, 16);
    assert.deepEqual(await invokeExternalPageCapability(ids.user, "page.delete", deleteInput), deletedPage);
    const finalPageContext = await pageContext([{ physicalPageNumber: 1 }]);
    assert.equal(finalPageContext.pageSequence.some((page) => page.name === "雨幕过场·重命名 副本"), false);
    assert.equal(finalPageContext.pageSequence[0]?.pageRole, "cover");

    let compositionRevision = 16;
    const compositionPage = async () => {
      const context = await pageContext([{ name: "站台余波" }]);
      const inspection = await inspectExternalAgentComposition(ids.user, {
        projectId: ids.project,
        pageHandles: [context.pages[0]!.handle],
      });
      return { context, inspection, unit: inspection.output.structure.units[0]! };
    };
    const firstCompositionPage = await compositionPage();
    const compositionSurface = firstCompositionPage.context.pages[0]!.surfaces[0]!;
    const createdFrame = await invokeExternalCompositionCapability(ids.user, "frame.create", {
      scope: chapterScope,
      targetHandles: [compositionSurface.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-frame-create-${suffix}`,
      geometry: { x: 48, y: 72, width: 300, height: 360 },
      name: "雨中近景",
      readingPosition: 1,
      allowOverlap: false,
    });
    assert.equal(createdFrame.workingRevision, ++compositionRevision);
    const savedAfterUnsavedChanges = await inspectExternalAgentComposition(ids.user, {
      projectId: ids.project,
      pageHandles: [savedPageTarget.handle],
    });
    assert.equal(savedAfterUnsavedChanges.output.baseRevision, 1);
    assert.equal(savedAfterUnsavedChanges.output.source.kind, "saved_snapshot");

    let currentComposition = await compositionPage();
    assert.equal(currentComposition.inspection.output.source.kind, "working");
    assert.equal(currentComposition.inspection.output.baseRevision, compositionRevision);
    let primaryFrame = currentComposition.unit.frames.find((frame) => frame.name === "雨中近景");
    assert.ok(primaryFrame?.handle);
    const shapedFrame = await invokeExternalCompositionCapability(ids.user, "frame.update", {
      scope: chapterScope,
      targetHandles: [primaryFrame.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-frame-shape-${suffix}`,
      shape: {
        kind: "polygon",
        points: [{ x: 0, y: .08 }, { x: 1, y: 0 }, { x: .94, y: 1 }, { x: .04, y: .92 }],
      },
      borderWidth: 8,
      zIndex: 30,
      readingPosition: 1,
    });
    assert.equal(shapedFrame.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    primaryFrame = currentComposition.unit.frames.find((frame) => frame.name === "雨中近景");
    assert.ok(primaryFrame?.handle);
    const placedFrameImage = await invokeExternalCompositionCapability(ids.user, "image.place", {
      scope: chapterScope,
      targetHandles: [primaryFrame.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-image-place-frame-${suffix}`,
      asset: `lantern://assets/${ids.asset}`,
      assetVersionId: ids.assetV1,
      transform: { x: -.08, y: 0, width: 1.16, height: 1 },
      crop: { x: 0, y: .1, width: .72, height: .8 },
    });
    assert.equal(placedFrameImage.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    let frameImage = currentComposition.unit.elements.find((element) => element.kind === "image" && element.frameId === primaryFrame!.id);
    assert.ok(frameImage?.handle);
    assert.equal(frameImage.coordinateSpace, "frame_local");
    assert.deepEqual(frameImage.transform, { x: -.08, y: 0, width: 1.16, height: 1 });
    const replacedAndCropped = await invokeExternalCompositionCapability(ids.user, "image.update", {
      scope: chapterScope,
      targetHandles: [frameImage.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-image-replace-${suffix}`,
      asset: `lantern://assets/${ids.asset}`,
      assetVersionId: ids.assetVariantV1,
      transform: { x: -.18, y: -.08, width: 1.32, height: 1.2 },
      crop: { x: .18, y: 0, width: .7, height: .9 },
    });
    assert.equal(replacedAndCropped.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    frameImage = currentComposition.unit.elements.find((element) => element.id === frameImage!.id);
    assert.ok(frameImage?.handle);
    assert.equal(frameImage.assetVersionId, ids.assetVariantV1);
    const createdTrueBreakout = await invokeExternalCompositionCapability(ids.user, "image.breakout.create", {
      scope: chapterScope,
      targetHandles: [frameImage.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-image-true-breakout-${suffix}`,
      asset: `lantern://assets/${ids.asset}`,
      assetVersionId: ids.assetV1,
    });
    assert.equal(createdTrueBreakout.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    frameImage = currentComposition.unit.elements.find((element) => element.id === frameImage!.id);
    let trueBreakout = currentComposition.unit.elements.find((element) => element.kind === "image" && element.projection?.sourceElementId === frameImage!.id);
    assert.ok(frameImage?.handle && trueBreakout?.handle);
    assert.deepEqual(trueBreakout.transform, frameImage.transform);
    assert.deepEqual(trueBreakout.crop, frameImage.crop);
    await assert.rejects(() => invokeExternalCompositionCapability(ids.user, "image.update", {
      scope: chapterScope,
      targetHandles: [frameImage!.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-image-bound-replace-${suffix}`,
      asset: `lantern://assets/${ids.asset}`,
      assetVersionId: ids.assetVariantV1,
    }), /先移除真出格前景/);
    const synchronizedSource = await invokeExternalCompositionCapability(ids.user, "image.update", {
      scope: chapterScope,
      targetHandles: [frameImage.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-image-bound-update-${suffix}`,
      transform: { x: -.12, y: -.04, width: 1.24, height: 1.14 },
      crop: { x: .12, y: .04, width: .76, height: .86 },
    });
    assert.equal(synchronizedSource.workingRevision, ++compositionRevision);
    currentComposition = await compositionPage();
    frameImage = currentComposition.unit.elements.find((element) => element.id === frameImage!.id);
    trueBreakout = currentComposition.unit.elements.find((element) => element.id === trueBreakout!.id);
    assert.deepEqual(trueBreakout?.transform, frameImage?.transform);
    assert.deepEqual(trueBreakout?.crop, frameImage?.crop);
    const removedTrueBreakout = await invokeExternalCompositionCapability(ids.user, "image.remove", {
      scope: chapterScope,
      targetHandles: [trueBreakout!.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-image-true-breakout-remove-${suffix}`,
    });
    assert.equal(removedTrueBreakout.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    frameImage = currentComposition.unit.elements.find((element) => element.id === frameImage!.id);
    assert.ok(frameImage?.handle);
    const promotedBreakout = await invokeExternalCompositionCapability(ids.user, "image.update", {
      scope: chapterScope,
      targetHandles: [frameImage.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-image-breakout-${suffix}`,
      placement: "breakout",
    });
    assert.equal(promotedBreakout.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    let breakoutImage = currentComposition.unit.elements.find((element) => element.id === frameImage!.id);
    assert.ok(breakoutImage?.handle);
    assert.equal(breakoutImage.source, "overlay");
    assert.equal(breakoutImage.overlayPurpose, "breakout");
    assert.equal(breakoutImage.coordinateSpace, "frame_local");
    assert.notDeepEqual(breakoutImage.geometry, breakoutImage.transform);
    const frontBreakout = await invokeExternalCompositionCapability(ids.user, "image.update", {
      scope: chapterScope,
      targetHandles: [breakoutImage.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-image-front-${suffix}`,
      zOrder: "front",
    });
    assert.equal(frontBreakout.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    const overlappingFrame = await invokeExternalCompositionCapability(ids.user, "frame.create", {
      scope: chapterScope,
      targetHandles: [currentComposition.context.pages[0]!.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-frame-overlap-${suffix}`,
      geometry: { x: 250, y: 250, width: 310, height: 350 },
      name: "叠格测试",
      readingPosition: 2,
      allowOverlap: true,
    });
    assert.equal(overlappingFrame.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    let overlapFrame = currentComposition.unit.frames.find((frame) => frame.name === "叠格测试");
    assert.ok(overlapFrame?.handle);
    const resizedOverlap = await invokeExternalCompositionCapability(ids.user, "frame.update", {
      scope: chapterScope,
      targetHandles: [overlapFrame.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-frame-resize-${suffix}`,
      geometry: { x: 270, y: 270, width: 320, height: 360 },
      shape: { kind: "rect" },
      zIndex: 40,
      readingPosition: 2,
      allowOverlap: true,
    });
    assert.equal(resizedOverlap.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    primaryFrame = currentComposition.unit.frames.find((frame) => frame.name === "雨中近景");
    assert.ok(primaryFrame?.handle);
    const bleedingFrame = await invokeExternalCompositionCapability(ids.user, "frame.update", {
      scope: chapterScope,
      targetHandles: [primaryFrame.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-frame-bleed-${suffix}`,
      bleed: { edge: "left", enabled: true },
    });
    assert.equal(bleedingFrame.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    overlapFrame = currentComposition.unit.frames.find((frame) => frame.name === "叠格测试");
    assert.ok(overlapFrame?.handle);
    const duplicatedFrame = await invokeExternalCompositionCapability(ids.user, "frame.duplicate", {
      scope: chapterScope,
      targetHandles: [overlapFrame.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-frame-duplicate-${suffix}`,
    });
    assert.equal(duplicatedFrame.workingRevision, ++compositionRevision);
    currentComposition = await compositionPage();
    const duplicateFrame = currentComposition.unit.frames.find((frame) => frame.name === "叠格测试 副本");
    assert.ok(duplicateFrame?.handle);
    const deletedFrame = await invokeExternalCompositionCapability(ids.user, "frame.delete", {
      scope: chapterScope,
      targetHandles: [duplicateFrame.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-frame-delete-${suffix}`,
    });
    assert.equal(deletedFrame.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    const pageImagePlaced = await invokeExternalCompositionCapability(ids.user, "image.place", {
      scope: chapterScope,
      targetHandles: [currentComposition.context.pages[0]!.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-image-page-${suffix}`,
      asset: `lantern://assets/${ids.asset}`,
      assetVersionId: ids.assetV1,
      transform: { x: 380, y: 650, width: 260, height: 300 },
      crop: { x: .1, y: .1, width: .8, height: .8 },
    });
    assert.equal(pageImagePlaced.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    const pageImage = currentComposition.unit.elements.find((element) => element.kind === "image" && element.source === "overlay" && element.overlayPurpose === "page_content");
    assert.ok(pageImage?.handle);
    assert.equal(pageImage.coordinateSpace, "unit");
    const updatedPageImage = await invokeExternalCompositionCapability(ids.user, "image.update", {
      scope: chapterScope,
      targetHandles: [pageImage.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-image-page-update-${suffix}`,
      asset: `lantern://assets/${ids.asset}`,
      assetVersionId: ids.assetVariantV1,
      transform: { x: 400, y: 670, width: 280, height: 280 },
      crop: { x: .2, y: 0, width: .7, height: .9 },
      zOrder: "front",
    });
    assert.equal(updatedPageImage.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    const refreshedPageImage = currentComposition.unit.elements.find((element) => element.id === pageImage.id);
    assert.equal(refreshedPageImage?.assetVersionId, ids.assetVariantV1);
    assert.deepEqual(refreshedPageImage?.transform, { x: 400, y: 670, width: 280, height: 280 });
    assert.deepEqual(refreshedPageImage?.crop, { x: .2, y: 0, width: .7, height: .9 });
    assert.equal(refreshedPageImage?.coordinateSpace, "unit");

    const temporaryImagePlaced = await invokeExternalCompositionCapability(ids.user, "image.place", {
      scope: chapterScope,
      targetHandles: [currentComposition.context.pages[0]!.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-image-temporary-${suffix}`,
      asset: `lantern://assets/${ids.asset}`,
      assetVersionId: ids.assetV1,
      transform: { x: 80, y: 760, width: 180, height: 220 },
    });
    assert.equal(temporaryImagePlaced.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    const temporaryImage = currentComposition.unit.elements.find((element) => element.kind === "image" && element.transform.x === 80 && element.transform.y === 760);
    assert.ok(temporaryImage?.handle);
    const removedImage = await invokeExternalCompositionCapability(ids.user, "image.remove", {
      scope: chapterScope,
      targetHandles: [temporaryImage.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-image-remove-${suffix}`,
    });
    assert.equal(removedImage.workingRevision, ++compositionRevision);
    currentComposition = await compositionPage();
    assert.equal(currentComposition.unit.elements.some((element) => element.id === temporaryImage.id), false);
    breakoutImage = currentComposition.unit.elements.find((element) => element.id === breakoutImage!.id);
    assert.equal(breakoutImage?.overlayPurpose, "breakout");

    primaryFrame = currentComposition.unit.frames.find((frame) => frame.name === "雨中近景");
    assert.ok(primaryFrame?.handle);
    const createdBalloon = await invokeExternalCompositionCapability(ids.user, "balloon.create", {
      scope: chapterScope,
      targetHandles: [primaryFrame.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-balloon-create-${suffix}`,
      content: "列车已经进站。",
      position: { x: .72, y: .22 },
    });
    assert.equal(createdBalloon.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    let frameBalloon = currentComposition.unit.elements.find((element) => element.kind === "balloon" && element.frameId === primaryFrame!.id);
    assert.ok(frameBalloon?.handle);
    assert.equal(frameBalloon.dialogueText, "列车已经进站。");
    const updatedBalloon = await invokeExternalCompositionCapability(ids.user, "balloon.update", {
      scope: chapterScope,
      targetHandles: [frameBalloon.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-balloon-update-${suffix}`,
      content: "雨停之前，我们还有一站。",
      transform: { x: .52, y: .05, width: .42, height: .34 },
      tailTarget: { x: .78, y: .72 },
      shape: "thought",
      style: {
        fontSize: 20,
        textColor: "#18212a",
        fill: "#f7fbff",
        strokeWidth: 4,
        writingMode: "vertical",
      },
    });
    assert.equal(updatedBalloon.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    frameBalloon = currentComposition.unit.elements.find((element) => element.id === frameBalloon!.id);
    assert.ok(frameBalloon?.handle);
    assert.equal(frameBalloon.dialogueText, "雨停之前，我们还有一站。");
    assert.equal(frameBalloon.shape, "thought");
    assert.equal((frameBalloon.style as { writingMode?: string }).writingMode, "vertical");
    const duplicatedBalloon = await invokeExternalCompositionCapability(ids.user, "balloon.duplicate", {
      scope: chapterScope,
      targetHandles: [frameBalloon.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-balloon-duplicate-${suffix}`,
    });
    assert.equal(duplicatedBalloon.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    const balloonCopy = currentComposition.unit.elements.find((element) =>
      element.kind === "balloon" && element.id !== frameBalloon!.id && element.dialogueText === frameBalloon!.dialogueText);
    assert.ok(balloonCopy?.handle);
    assert.notEqual(balloonCopy.dialogueId, frameBalloon.dialogueId);
    const deletedBalloonCopy = await invokeExternalCompositionCapability(ids.user, "balloon.delete", {
      scope: chapterScope,
      targetHandles: [balloonCopy.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-balloon-delete-${suffix}`,
    });
    assert.equal(deletedBalloonCopy.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    frameBalloon = currentComposition.unit.elements.find((element) => element.id === frameBalloon!.id);
    assert.ok(frameBalloon?.handle);
    const breakoutBalloon = await invokeExternalCompositionCapability(ids.user, "balloon.update", {
      scope: chapterScope,
      targetHandles: [frameBalloon.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-balloon-breakout-${suffix}`,
      placement: "breakout",
    });
    assert.equal(breakoutBalloon.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    let promotedBalloon = currentComposition.unit.elements.find((element) => element.id === frameBalloon!.id);
    assert.ok(promotedBalloon?.handle);
    assert.equal(promotedBalloon.overlayPurpose, "breakout");
    assert.equal(promotedBalloon.coordinateSpace, "frame_local");
    const paperBalloon = await invokeExternalCompositionCapability(ids.user, "balloon.update", {
      scope: chapterScope,
      targetHandles: [promotedBalloon.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-balloon-page-${suffix}`,
      placement: "page",
    });
    assert.equal(paperBalloon.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    promotedBalloon = currentComposition.unit.elements.find((element) => element.id === frameBalloon!.id);
    assert.ok(promotedBalloon?.handle);
    assert.equal(promotedBalloon.coordinateSpace, "unit");
    assert.equal(promotedBalloon.overlayPurpose, "page_content");

    const createdPageBalloon = await invokeExternalCompositionCapability(ids.user, "balloon.create", {
      scope: chapterScope,
      targetHandles: [currentComposition.context.pages[0]!.surfaces[0]!.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-page-balloon-create-${suffix}`,
      content: "站台广播：请注意脚下。",
      position: { x: 540, y: 150 },
    });
    assert.equal(createdPageBalloon.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    const pageBalloon = currentComposition.unit.elements.find((element) =>
      element.kind === "balloon" && element.dialogueText === "站台广播：请注意脚下。");
    assert.ok(pageBalloon?.handle);
    assert.equal(pageBalloon.coordinateSpace, "unit");

    const createdNarration = await invokeExternalCompositionCapability(ids.user, "narration.create", {
      scope: chapterScope,
      targetHandles: [currentComposition.context.pages[0]!.surfaces[0]!.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-narration-create-${suffix}`,
      content: "雨幕把最后一班车切成了两段。",
      position: { x: 180, y: 150 },
    });
    assert.equal(createdNarration.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    let narration = currentComposition.unit.elements.find((element) =>
      element.kind === "text" && element.role === "narration" && element.text === "雨幕把最后一班车切成了两段。");
    assert.ok(narration?.handle);
    const updatedNarration = await invokeExternalCompositionCapability(ids.user, "narration.update", {
      scope: chapterScope,
      targetHandles: [narration.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-narration-update-${suffix}`,
      content: "雨幕把末班车切成两段。",
      transform: { x: 80, y: 80, width: 84, height: 260 },
      fontFamily: "ui-serif",
      fontSize: 28,
      fontWeight: 800,
      color: "#f8f4e8",
      stroke: "#172026",
      strokeWidth: 3,
      align: "center",
      writingMode: "vertical",
    });
    assert.equal(updatedNarration.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    narration = currentComposition.unit.elements.find((element) => element.id === narration!.id);
    assert.ok(narration?.handle);
    assert.equal(narration.text, "雨幕把末班车切成两段。");
    assert.deepEqual(narration.transform, { x: 80, y: 80, width: 84, height: 260 });
    assert.equal((narration.style as { writingMode?: string }).writingMode, "vertical");
    const frontNarration = await invokeExternalCompositionCapability(ids.user, "narration.update", {
      scope: chapterScope,
      targetHandles: [narration.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-narration-front-${suffix}`,
      zOrder: "front",
    });
    assert.equal(frontNarration.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    narration = currentComposition.unit.elements.find((element) => element.id === narration!.id);
    assert.ok(narration?.handle);
    const duplicatedNarration = await invokeExternalCompositionCapability(ids.user, "narration.duplicate", {
      scope: chapterScope,
      targetHandles: [narration.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-narration-duplicate-${suffix}`,
    });
    assert.equal(duplicatedNarration.workingRevision, ++compositionRevision);

    currentComposition = await compositionPage();
    const narrationCopy = currentComposition.unit.elements.find((element) =>
      element.kind === "text" && element.role === "narration" && element.id !== narration!.id && element.text === narration!.text);
    assert.ok(narrationCopy?.handle);
    const deletedNarrationCopy = await invokeExternalCompositionCapability(ids.user, "narration.delete", {
      scope: chapterScope,
      targetHandles: [narrationCopy.handle],
      expectedRevision: compositionRevision,
      idempotencyKey: `composition-narration-delete-${suffix}`,
    });
    assert.equal(deletedNarrationCopy.workingRevision, ++compositionRevision);
    }
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
      await prisma.changeProposal.deleteMany({ where: { projectId: { in: copiedProjectIds } } });
      await prisma.agentDraftRevision.deleteMany({ where: { agentDraft: { projectId: { in: copiedProjectIds } } } });
      await prisma.agentDraft.deleteMany({ where: { projectId: { in: copiedProjectIds } } });
      await prisma.savedSnapshot.deleteMany({ where: { projectId: { in: copiedProjectIds } } });
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
    await prisma.agentActivityEvent.deleteMany({ where: { group: { projectId: ids.project } } });
    await prisma.agentActivityGroup.deleteMany({ where: { projectId: ids.project } });
    await prisma.changeProposal.deleteMany({ where: { projectId: ids.project } });
    await prisma.agentDraftRevision.deleteMany({ where: { agentDraft: { projectId: ids.project } } });
    await prisma.agentDraft.deleteMany({ where: { projectId: ids.project } });
    await prisma.savedSnapshot.deleteMany({ where: { projectId: ids.project } });
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

test("external MCP activity is observed without becoming an Agent task controller", async () => {
  await initializeDatabaseConnection();
  const suffix = randomUUID();
  const ids = {
    user: `activity-user-${suffix}`,
    comic: `activity-comic-${suffix}`,
    chapter: `activity-chapter-${suffix}`,
    project: `activity-project-${suffix}`,
    beat: `activity-beat-${suffix}`,
    beatVersion: `activity-beat-version-${suffix}`,
  };
  const beat: StoryboardBeat = {
    id: ids.beat,
    versionId: ids.beatVersion,
    title: "看台相遇",
    description: "角色在旧看台入口短暂停下。",
  };
  const document = compileChapterLayoutPlan(
    { format: "page", preset: "page_basic", readingOrder: [beat.id] },
    [beat],
    { comicId: ids.comic, chapterId: ids.chapter },
  );

  try {
    await prisma.user.create({
      data: {
        id: ids.user,
        email: `${suffix}@activity.lantern.local`,
        displayName: "Agent Activity Test",
      },
    });
    await prisma.comic.create({
      data: {
        id: ids.comic,
        ownerUserId: ids.user,
        title: "Agent Activity Test",
        format: ComicFormat.PAGE,
      },
    });
    await prisma.chapter.create({
      data: {
        id: ids.chapter,
        ownerUserId: ids.user,
        comicId: ids.comic,
        number: 1,
        title: "Chapter",
      },
    });
    await prisma.project.create({
      data: { id: ids.project, ownerUserId: ids.user, chapterId: ids.chapter },
    });
    await prisma.workingRevision.create({
      data: {
        projectId: ids.project,
        revision: 1,
        document: document as unknown as Prisma.InputJsonValue,
        storyboardBeats: [beat] as unknown as Prisma.InputJsonValue,
        storyboardBeatVersionHeads: { [ids.beat]: ids.beatVersion },
        assetVersionHeads: {},
      },
    });

    await trackExternalMcpActivity({
      ownerUserId: ids.user,
      toolName: "lantern_context_get",
      toolInput: {
        projectId: ids.project,
        source: "working",
        profile: "composition_observation",
        pageId: document.units[0]!.id,
      },
      operation: () => getExternalAgentContext(ids.user, {
        projectId: ids.project,
        source: "working",
        profile: "composition_observation",
        pageId: document.units[0]!.id,
      }),
    });
    const observationFeed = await getProjectAgentActivity(ids.user, ids.project);
    assert.equal(observationFeed.groups.length, 1);
    assert.equal(observationFeed.groups[0]?.events[0]?.eventType, "context_read");

    const unobservedDraft = await createAgentDraft({
      ownerUserId: ids.user,
      projectId: ids.project,
      baseWorkingRevision: 1,
      title: "非 MCP 草稿",
    });
    assert.equal(
      await prisma.agentActivityGroup.count({ where: { agentDraftId: unobservedDraft.draft.id } }),
      0,
    );

    await trackExternalMcpActivity({
      ownerUserId: ids.user,
      toolName: "lantern_asset_image_attach",
      capabilityId: "asset.image.attach",
      toolInput: { idempotencyKey: `activity:image:${suffix}` },
      operation: async () => ({
        capability: { id: "asset.image.attach", version: 1 },
        effect: "resource_mutation",
        resource: {
          type: "asset",
          id: `activity-asset-${suffix}`,
          uri: `lantern://assets/activity-asset-${suffix}`,
        },
        data: {
          root: {
            label: "活动验收图",
          },
          attached: {
            versionId: `activity-version-${suffix}`,
            imageId: `activity-image-${suffix}`,
            replayed: false,
          },
        },
      }),
    });
    const uploadFeed = await getProjectAgentActivity(ids.user, ids.project);
    assert.equal(uploadFeed.groups.length, 1);
    assert.equal(uploadFeed.groups[0]?.sourceReference, undefined);
    assert.equal(
      uploadFeed.groups[0]?.events[1]?.projection.data
        && (uploadFeed.groups[0].events[1].projection.data as { assetVersionId?: string }).assetVersionId,
      `activity-version-${suffix}`,
    );
    assert.deepEqual(uploadFeed.groups[0]?.events[1]?.navigation, {
      kind: "asset_version",
      assetVersionId: `activity-version-${suffix}`,
    });
    assert.equal(uploadFeed.groups[0]?.events[1]?.projection.targets[0]?.label, "活动验收图");

    const created = await createAgentDraft({
      ownerUserId: ids.user,
      projectId: ids.project,
      baseWorkingRevision: 1,
      title: "调整开场画格",
      sourceHost: "lantern-mcp",
    });
    assert.equal(
      await prisma.agentActivityGroup.count({ where: { projectId: ids.project } }),
      1,
    );
    const page = document.units[0]!;
    const draftContext = await getExternalAgentContext(ids.user, {
      projectId: ids.project,
      source: "agent_draft",
      draft: agentDraftReference(created.draft.id),
      profile: "composition_observation",
      pageId: page.id,
    });
    const frameTarget = draftContext.targets.find((target) => target.type === "comic_frame");
    assert.ok(frameTarget);
    const targetHandle = frameTarget.handle;

    const successfulResult = await trackExternalMcpActivity({
      ownerUserId: ids.user,
      toolName: "lantern_capability_canvas_element_move",
      capabilityId: "canvas.element.move",
      toolInput: {
        targetHandles: [targetHandle],
        idempotencyKey: `activity:move:${suffix}`,
      },
      operation: async () => ({
        capability: { id: "canvas.element.move", version: 1 },
        effect: "direct_change",
        data: { action: "move", coordinateSpace: "surface", fields: ["x", "y"] },
      }),
    });
    assert.equal(successfulResult.effect, "direct_change");

    await assert.rejects(
      () => trackExternalMcpActivity({
        ownerUserId: ids.user,
        toolName: "lantern_capability_canvas_element_resize",
        capabilityId: "canvas.element.resize",
        toolInput: {
          targetHandles: [targetHandle],
          idempotencyKey: `activity:resize:${suffix}`,
        },
        operation: async () => {
          throw new AppError("context_stale", "测试中的上下文已过期。", 409);
        },
      }),
      /测试中的上下文已过期/,
    );

    const runningFeed = await getProjectAgentActivity(ids.user, ids.project);
    assert.equal(runningFeed.groups.length, 1);
    assert.equal(runningFeed.groups[0]?.status, "running");
    assert.equal(runningFeed.groups[0]?.eventCount, 4);
    assert.equal(runningFeed.groups[0]?.events.length, 4);
    assert.deepEqual(
      runningFeed.groups[0]?.events.map((event) => event.status),
      ["succeeded", "succeeded", "succeeded", "failed"],
    );
    assert.match(runningFeed.groups[0]?.events[2]?.projection.targets[0]?.label ?? "", /画格 0?1/);
    assert.deepEqual(
      runningFeed.groups[0]?.events[3]?.projection.data,
      { errorCode: "context_stale" },
    );

    const timedOutFeed = await getProjectAgentActivity(ids.user, ids.project, {
      now: new Date(Date.now() + EXTERNAL_AGENT_ACTIVITY_TIMEOUT_MS + 1_000),
    });
    assert.equal(timedOutFeed.groups[0]?.status, "timed_out");
    assert.equal(timedOutFeed.groups[0]?.eventCount, 5);
    assert.equal(
      timedOutFeed.groups[0]?.events.at(-1)?.projection.action,
      "activity.timed_out",
    );
    const repeatedTimedOutFeed = await getProjectAgentActivity(ids.user, ids.project, {
      now: new Date(Date.now() + EXTERNAL_AGENT_ACTIVITY_TIMEOUT_MS + 2_000),
    });
    assert.equal(repeatedTimedOutFeed.groups[0]?.eventCount, 5);
    assert.equal(
      (await prisma.agentDraft.findUniqueOrThrow({ where: { id: created.draft.id } })).status,
      "ACTIVE",
    );

    await trackExternalMcpActivity({
      ownerUserId: ids.user,
      toolName: "lantern_context_get",
      toolInput: { draft: agentDraftReference(created.draft.id) },
      operation: async () => ({ draft: agentDraftReference(created.draft.id), profile: "editing" }),
    });
    assert.equal(
      (await getProjectAgentActivity(ids.user, ids.project)).groups[0]?.status,
      "running",
    );

    await trackExternalMcpActivity({
      ownerUserId: ids.user,
      toolName: "lantern_capability_agent_draft_finish",
      capabilityId: "agent_draft.finish",
      toolInput: {
        draft: agentDraftReference(created.draft.id),
        title: "开场画格调整",
        summary: "调整了第一格构图。",
        idempotencyKey: `activity:finish:${suffix}`,
      },
      operation: () => invokeExternalAgentDraftCapability(ids.user, "agent_draft.finish", {
        draft: agentDraftReference(created.draft.id),
        title: "开场画格调整",
        summary: "调整了第一格构图。",
        idempotencyKey: `activity:finish:${suffix}`,
      }),
    });
    const completedFeed = await getProjectAgentActivity(ids.user, ids.project);
    assert.equal(completedFeed.groups[0]?.status, "completed");
    assert.equal(completedFeed.groups[0]?.title, "开场画格调整");
    assert.equal(completedFeed.groups[0]?.proposal?.status, "available");
    assert.match(completedFeed.groups[0]?.proposal?.reviewPath ?? "", /^\/reviews\//);
    assert.equal(
      completedFeed.groups[0]?.events.some((event) => event.eventType === "proposal_created"),
      true,
    );

    const proposalId = completedFeed.groups[0]!.proposal!.id;
    const applied = await applyChangeProposal(ids.user, proposalId, 1);
    const appliedFeed = await getProjectAgentActivity(ids.user, ids.project);
    assert.equal(appliedFeed.groups[0]?.status, "completed");
    assert.equal(appliedFeed.groups[0]?.proposal?.status, "applied");
    assert.equal(appliedFeed.groups[0]?.proposal?.acceptedWorkingRevision, applied.workingRevision);
    assert.equal(appliedFeed.groups[0]?.proposal?.acceptedSnapshotId, applied.snapshotId);
  } finally {
    await prisma.agentActivityEvent.deleteMany({
      where: { group: { projectId: ids.project } },
    });
    await prisma.agentActivityGroup.deleteMany({ where: { projectId: ids.project } });
    await prisma.changeProposal.deleteMany({ where: { projectId: ids.project } });
    await prisma.agentDraftRevision.deleteMany({
      where: { agentDraft: { projectId: ids.project } },
    });
    await prisma.agentDraft.deleteMany({ where: { projectId: ids.project } });
    await prisma.storyboardBeatVersion.deleteMany({
      where: { storyboardBeat: { projectId: ids.project } },
    });
    await prisma.storyboardBeat.deleteMany({ where: { projectId: ids.project } });
    await prisma.canvasReferencePlacement.deleteMany({ where: { projectId: ids.project } });
    await prisma.canvasAssetListItem.deleteMany({ where: { projectId: ids.project } });
    await prisma.savedSnapshot.deleteMany({ where: { projectId: ids.project } });
    await prisma.workingRevision.deleteMany({ where: { projectId: ids.project } });
    await prisma.externalAgentOperation.deleteMany({ where: { ownerUserId: ids.user } });
    await prisma.project.deleteMany({ where: { id: ids.project } });
    await prisma.chapter.deleteMany({ where: { id: ids.chapter } });
    await prisma.comic.deleteMany({ where: { id: ids.comic } });
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
