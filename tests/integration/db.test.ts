import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  AssetKind,
  CandidateKind,
  CandidateStatus,
  ComicFormat,
  TaskStatus,
  TaskType,
  type Prisma,
} from "@prisma/client";
import { compileChapterLayoutPlan } from "../../packages/layout-engine/src";
import { prisma } from "../../packages/server/src/db";
import { applyPageVariant, commitChangeSet, deletePageVariant, revertCandidateApplication, saveCandidateAsPageVariant } from "../../packages/server/src/workbench-service";
import { buildAgentContext, buildAgentContextDebugSnapshot } from "../../packages/agent-runtime/src/context-builder";
import type { StoryboardBeat } from "../../packages/shared/src";

test("database candidate apply and revert preserve version heads atomically", async () => {
  const suffix = randomUUID();
  const ids = {
    user: `it-user-${suffix}`,
    comic: `it-comic-${suffix}`,
    chapter: `it-chapter-${suffix}`,
    project: `it-project-${suffix}`,
    storyboardBeat: `it-storyboardBeat-${suffix}`,
    storyboardBeatV1: `it-storyboardBeat-v1-${suffix}`,
    dialogue: `it-dialogue-${suffix}`,
    asset: `it-asset-${suffix}`,
    assetV1: `it-asset-v1-${suffix}`,
    task: `it-task-${suffix}`,
    candidate: `it-candidate-${suffix}`,
    sibling: `it-sibling-${suffix}`,
  };
  const storyboardBeat: StoryboardBeat = {
    id: ids.storyboardBeat,
    versionId: ids.storyboardBeatV1,
    title: "雨夜候车",
    description: "远景中的雨幕与候车亭，角色不安地等待。",
  };
  const document = compileChapterLayoutPlan({ format: "page", preset: "page_basic", readingOrder: [storyboardBeat.id] }, [storyboardBeat]);
  document.comicId = ids.comic;
  document.chapterId = ids.chapter;
  document.dialogues.push({ id: ids.dialogue, storyboardBeatId: ids.storyboardBeat, storyboardBeatVersionId: ids.storyboardBeatV1, content: "旧对白" });

  try {
    await prisma.user.create({ data: { id: ids.user, email: `${suffix}@integration.lantern.local`, displayName: "persistent runtime Integration" } });
    await prisma.comic.create({ data: { id: ids.comic, ownerUserId: ids.user, title: "集成测试漫画", worldSummary: "雨夜城市会通过末班车留下失踪者线索。", format: ComicFormat.PAGE } });
    await prisma.chapter.create({ data: { id: ids.chapter, ownerUserId: ids.user, comicId: ids.comic, number: 1, title: "第一话" } });
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
      projectId: ids.project,
      kind: AssetKind.CHARACTER,
      name: "测试角色",
      description: "必须在布局和对白修改后继续保留",
      versions: { create: { id: ids.assetV1, version: 1, source: "integration_test" } },
    } });
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
      taskType: "frame_image_generate",
      instruction: "生成当前格",
      scope: "selected_comic_frame",
      selection: { type: "storyboard_beat", id: ids.storyboardBeat, pageId: document.units[0].id },
      explicitReferences: [{ objectType: "character", objectId: ids.asset, versionId: ids.assetV1 }],
    });
    assert.equal(context.explicitReferences[0].versionId, ids.assetV1);
    assert.equal(context.comic.worldSummary, "雨夜城市会通过末班车留下失踪者线索。");
    const comicFrame = document.units[0].frames[0];
    assert.ok(comicFrame);
    const frameContext = await buildAgentContext({
      ownerUserId: ids.user,
      projectId: ids.project,
      taskType: "frame_image_generate",
      instruction: "生成这个画格的格内成稿图",
      scope: "selected_comic_frame",
      selection: { type: "comic_frame", id: comicFrame.id, pageId: document.units[0].id },
    });
    assert.equal(frameContext.currentPage?.id, document.units[0].id);
    assert.equal(frameContext.currentComicFrame?.id, comicFrame.id);
    assert.equal(frameContext.currentStoryboardBeat?.id, ids.storyboardBeat);
    const debug = await buildAgentContextDebugSnapshot({
      ownerUserId: ids.user,
      projectId: ids.project,
      taskType: "frame_image_generate",
      instruction: "定位角色、分镜和页面",
      scope: "selected_comic_frame",
      selection: { type: "storyboard_beat", id: ids.storyboardBeat, pageId: document.units[0].id },
      explicitReferences: [{ objectType: "character", objectId: ids.asset, versionId: ids.assetV1 }],
    });
    assert.equal(debug.debugContractVersion, "context-debug-0.4");
    assert.equal(debug.contextIndex.assets.characters[0]?.id, ids.asset);
    assert.equal(debug.contextIndex.world.summary, "雨夜城市会通过末班车留下失踪者线索。");
    assert.equal(debug.contextIndex.storyboard.modelStoryboardBeatWindow[0]?.id, ids.storyboardBeat);
    assert.equal(debug.contextIndex.layout.pages[0]?.id, document.units[0].id);
    await assert.rejects(() => buildAgentContext({
      ownerUserId: ids.user,
      projectId: ids.project,
      taskType: "frame_image_generate",
      instruction: "尝试引用不属于当前空间的版本",
      scope: "selected_comic_frame",
      explicitReferences: [{ objectType: "character", objectId: ids.asset, versionId: `foreign-${suffix}` }],
    }), /引用对象不存在或不属于当前创作空间/);
    await prisma.generationTask.create({ data: {
      id: ids.task,
      ownerUserId: ids.user,
      projectId: ids.project,
      type: TaskType.DIALOGUE,
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

    const layoutCandidateId = `it-layout-candidate-${suffix}`;
    await prisma.candidate.create({ data: {
      id: layoutCandidateId, ownerUserId: ids.user, projectId: ids.project, taskId: ids.task,
      kind: CandidateKind.PAGE_LAYOUT, status: CandidateStatus.AVAILABLE, title: "轻微调整编排", changeSummary: "只移动当前画格",
      targetLabel: "当前页", target: { type: "presentation_unit", id: document.units[0].id }, baseRevision: 3,
      payload: { format: "page", readingOrder: [ids.storyboardBeat] },
      operations: [{ type: "move_frame", unitId: document.units[0].id, frameId: comicFrame.id, position: { x: comicFrame.geometry.x + 1, y: comicFrame.geometry.y } }],
    } });
    const variant = await saveCandidateAsPageVariant(ids.user, layoutCandidateId, "测试页面方案");
    assert.equal(variant.kind, "LAYOUT_ONLY");
    const variantApplied = await applyPageVariant(ids.user, variant.id, 3);
    assert.equal(variantApplied.working.revision, 4);
    assert.equal(variantApplied.working.document.units[0].frames[0].geometry.x, comicFrame.geometry.x + 1);
    await deletePageVariant(ids.user, variant.id);
    assert.ok((await prisma.pageVariant.findUniqueOrThrow({ where: { id: variant.id } })).archivedAt);
  } finally {
    await prisma.candidate.deleteMany({ where: { projectId: ids.project } });
    await prisma.pageVariant.deleteMany({ where: { projectId: ids.project } });
    await prisma.generationAttempt.deleteMany({ where: { task: { projectId: ids.project } } });
    await prisma.generationTask.deleteMany({ where: { projectId: ids.project } });
    await prisma.storyboardBeatVersion.deleteMany({ where: { storyboardBeat: { projectId: ids.project } } });
    await prisma.storyboardBeat.deleteMany({ where: { projectId: ids.project } });
    await prisma.assetVersion.deleteMany({ where: { asset: { projectId: ids.project } } });
    await prisma.asset.deleteMany({ where: { projectId: ids.project } });
    await prisma.workingRevision.deleteMany({ where: { projectId: ids.project } });
    await prisma.project.deleteMany({ where: { id: ids.project } });
    await prisma.chapter.deleteMany({ where: { id: ids.chapter } });
    await prisma.comic.deleteMany({ where: { id: ids.comic } });
    await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.$disconnect();
  }
});
