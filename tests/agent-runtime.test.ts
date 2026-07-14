import assert from "node:assert/strict";
import test from "node:test";
import { decideInteraction, enforceSafetyDecision } from "../packages/agent-runtime/src/orchestrator";
import { agentContextSnapshotSchema, assetDraftSchema, dialogueOutputSchema, parseCandidatePayload, storyboardOutputSchema } from "../packages/agent-runtime/src/schemas";
import { applyWorkspaceChangeSet } from "../packages/editor-core/src";
import { createInitialFixture } from "../packages/demo-runtime/src";
import { mergeAssetVersionHeads } from "../packages/shared/src";
import { preferredReferenceVersionIds } from "../packages/agent-runtime/src/task-processor";

test("whole chapter changes are always forced through confirmation", () => {
  const decision = enforceSafetyDecision(
    { message: "把整话全部重排", selection: { type: "chapter" }, contextSummary: {} },
    { kind: "ready_to_run", message: "run", scope: "current_page", taskType: "page_layout" },
  );
  assert.equal(decision.kind, "needs_confirmation");
  assert.equal(decision.scope, "whole_chapter");
});

test("local refine without a selected target asks for input", () => {
  const decision = enforceSafetyDecision(
    { message: "只改当前格的表情", selection: { type: "none" }, contextSummary: {} },
    { kind: "ready_to_run", message: "run", scope: "selected_comic_frame", taskType: "frame_image_refine" },
  );
  assert.equal(decision.kind, "needs_input");
});

test("greeting stays conversational and never restores or creates a task", async () => {
  const decision = await decideInteraction({ message: "你好", selection: { type: "none" }, contextSummary: {} });
  assert.equal(decision.kind, "direct_answer");
  assert.match(decision.message, /你好|我在/);
});

test("explicit asset creation starts a candidate task instead of repeated clarification", () => {
  const decision = enforceSafetyDecision(
    { message: "创建一个角色：沉默寡言的转学生", intent: "人物", selection: { type: "none" }, contextSummary: {} },
    { kind: "needs_input", message: "还需要更多细节", questions: [{ id: "detail", field: "detail", prompt: "请补充", required: true }] },
  );
  assert.deepEqual(decision, {
    kind: "ready_to_run",
    message: "我会先按当前描述生成可编辑的资产候选；细节可以在资产画布中继续完善。",
    scope: "reference_only",
    taskType: "asset_parse",
  });
});

test("storyboard boundary accepts concise title and general description", () => {
  const parsed = storyboardOutputSchema.parse({
    options: [{
      id: 1,
      title: "安静悬念",
      pacingIntent: "逐步推进",
      storyboardBeats: [{
        temporaryId: 1,
        title: "空教室",
        description: "远景中窗帘被夕风吹动，保持夕光方向。",
      }],
    }],
  });
  assert.equal(parsed.options[0].id, "1");
  assert.equal(parsed.options[0].storyboardBeats[0].title, "空教室");
  assert.match(parsed.options[0].storyboardBeats[0].description, /夕光/);
});

test("explicit storyboard requests cannot be misrouted to layout", () => {
  const decision = enforceSafetyDecision({
    message: "帮我生成分镜",
    selection: { type: "none" },
    contextSummary: {},
  }, {
    kind: "ready_to_run",
    message: "错误路由",
    scope: "current_page",
    taskType: "page_layout",
  });
  assert.equal(decision.kind, "ready_to_run");
  assert.equal(decision.taskType, "storyboard");
});

test("asset draft boundary normalizes common model aliases and non-string attributes", () => {
  const parsed = assetDraftSchema.parse({
    asset: {
      type: "角色",
      basicInfo: { name: "小艾", description: "沉默寡言的黑发高中生" },
      attributes: { age: 16, traits: ["黑色短发", "校服"], quiet: true },
    },
  });
  assert.equal(parsed.kind, "character");
  assert.equal(parsed.name, "小艾");
  assert.deepEqual(parsed.attributes, { ageStage: "16", identity: "黑色短发、校服" });
});

test("dialogue schema assigns stable line ids and requires versioned character speakers", () => {
  const parsed = dialogueOutputSchema.parse({
    changeSummary: "压缩当前格对白",
    lines: [{ storyboardBeatId: "fixture-rain-beat-1", text: "别上车。", speaker: { objectType: "character", objectId: "character-1", versionId: "character-1-v2" } }],
  });
  assert.equal(parsed.lines[0].lineId, "line-1");
  assert.throws(() => dialogueOutputSchema.parse({
    changeSummary: "错误说话人",
    lines: [{ storyboardBeatId: "fixture-rain-beat-1", text: "别上车。", speaker: { objectType: "character", objectId: "character-1" } }],
  }), /versionId/);
});

test("replace_storyboard_beats remains a finite atomic workspace operation", () => {
  const fixture = createInitialFixture();
  const nextStoryboardBeats = fixture.storyboardBeats.slice(0, 2);
  const result = applyWorkspaceChangeSet(
    { working: fixture.working, storyboardBeats: fixture.storyboardBeats },
    {
      id: "replace-storyboardBeats-test",
      projectId: fixture.working.projectId,
      baseRevision: fixture.working.revision,
      source: "manual",
      operations: [{ type: "replace_storyboard_beats", storyboardBeats: nextStoryboardBeats }],
    },
  );
  assert.equal(result.working.revision, 2);
  assert.equal(result.storyboardBeats.length, 2);
});

test("document candidate application preserves non-LCD asset version heads", () => {
  assert.deepEqual(
    mergeAssetVersionHeads(
      {
        "asset-character": "character-v2",
        "asset-scene": "scene-v1",
        "asset-old-storyboardBeat": "old-storyboardBeat-v1",
      },
      [
        { assetId: "asset-new-storyboardBeat", assetVersionId: "new-storyboardBeat-v1" },
        { assetId: "asset-old-storyboardBeat", assetVersionId: "old-storyboardBeat-v2" },
      ],
    ),
    {
      "asset-character": "character-v2",
      "asset-scene": "scene-v1",
      "asset-old-storyboardBeat": "old-storyboardBeat-v2",
      "asset-new-storyboardBeat": "new-storyboardBeat-v1",
    },
  );
});

test("agent context snapshot enforces bounded storyboardBeats and immutable references", () => {
  const snapshot = {
    task: { type: "frame_image_generate", instruction: "生成当前格", scope: "selected_comic_frame" },
    comic: { id: "comic-1", title: "雨夜车站", summary: "", worldSummary: "雨夜末班车会留下失踪者线索。", format: "page", readingDirection: "ltr", styleSummary: "黑白漫画" },
    chapter: { id: "chapter-1", title: "第一话", summary: "" },
    projectId: "project-1",
    workingRevision: 3,
    selection: { type: "storyboard_beat", id: "fixture-rain-beat-1", pageId: "page-1" },
    storyboardBeats: [{ id: "fixture-rain-beat-1", versionId: "beat-1-v2", title: "雨夜候车", description: "远景中的车站，人物不安地等待。" }],
    assets: [{ id: "asset-character", kind: "character", name: "林澄", description: "黑发少女", attributes: {}, versionId: "asset-character-v1" }],
    explicitReferences: [{ objectType: "character", objectId: "asset-character", versionId: "asset-character-v1" }],
    recentConversation: [{ role: "user", content: "雨再大一点" }],
    omittedContext: [],
  } as const;
  assert.equal(agentContextSnapshotSchema.parse(snapshot).workingRevision, 3);
  assert.throws(() => agentContextSnapshotSchema.parse({
    ...snapshot,
    explicitReferences: [{ objectType: "character", objectId: "asset-character" }],
  }), /versionId/);
});

test("storyboardBeat refine always keeps the current image as the first provider reference", () => {
  assert.deepEqual(preferredReferenceVersionIds({
    explicitReferences: [{ objectType: "character", objectId: "character-1", versionId: "character-v2" }],
    assets: [{ id: "scene-1", kind: "scene", name: "雨站", description: "", attributes: {}, versionId: "scene-v1" }],
  }, ["current-storyboardBeat-image-v3"]), ["current-storyboardBeat-image-v3", "character-v2"]);
});

test("candidate payloads are discriminated and reject incomplete persisted data", () => {
  assert.deepEqual(parseCandidatePayload("page_layout", { format: "page", readingOrder: ["fixture-rain-beat-1"] }), { format: "page", readingOrder: ["fixture-rain-beat-1"] });
  assert.throws(() => parseCandidatePayload("frame_image", { changeSummary: "缺少输出版本" }), /outputAssetVersionIds|promptSummary/);
  assert.throws(() => parseCandidatePayload("dialogue", { changeSummary: "缺少基础版本", storyboardBeats: [{ storyboardBeatId: "fixture-rain-beat-1", lines: [] }] }), /baseStoryboardBeatVersionId|lines/);
});
