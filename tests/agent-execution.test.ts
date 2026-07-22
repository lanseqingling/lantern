import assert from "node:assert/strict";
import test from "node:test";
import { CandidateKind, TaskType } from "@prisma/client";
import { runAgentLoop, type AgentLoopCheckpoint } from "@lantern/agent-runtime/agent-loop";
import { getAgentCapability, semanticCapabilityCatalogManifest, type AgentTaskType } from "@lantern/agent-runtime/capability-registry";
import { normalizeSelectionForCurrentView } from "@lantern/agent-runtime/context-builder";
import { guardInteractionPlan, type InteractionInput } from "@lantern/agent-runtime/orchestrator";
import { assetDraftSchema, explicitDialogueReferenceSchema, explicitWorkspaceReferencesSchema, interactionPlanSchema, parseCandidatePayload, type InteractionPlan } from "@lantern/agent-runtime/schemas";
import { assertTaskCreationAllowed } from "@lantern/agent-runtime/task-service";
import { assertCandidateApplicationAllowed, assertFrameCandidateApplicationTarget } from "@lantern/server/candidate-service";
import { isWorkbenchAgentCandidateVisible, workbenchAgentCandidateKinds, workbenchAgentTaskTypes } from "@lantern/server/workbench-agent-visibility";

function guardedDecision(input: InteractionInput, plan: InteractionPlan) {
  const route = guardInteractionPlan(input, plan);
  assert.equal(route.kind, "decision");
  if (route.kind !== "decision") throw new Error("expected decision route");
  return route.decision;
}

const baseInteractionInput: InteractionInput = {
  message: "测试消息",
  scope: "current_page",
  selection: { type: "none" },
  contextSummary: {},
};

test("the current canvas view discards a selection left on another page", () => {
  assert.deepEqual(normalizeSelectionForCurrentView(
    { type: "comic_frame", id: "frame-09", pageId: "spread-03-04", label: "画格 09" },
    "page-01",
    ["page-01", "page-02"],
  ), { type: "none", pageId: "page-01", label: "当前页面" });
  assert.deepEqual(normalizeSelectionForCurrentView(
    { type: "comic_frame", id: "frame-01", pageId: "page-01", label: "画格 01" },
    "page-01",
    ["page-01", "page-02"],
  ), { type: "comic_frame", id: "frame-01", pageId: "page-01", label: "画格 01" });
});

test("P0 only registers single-frame storyboard and asset generation tasks", () => {
  const taskTypes: AgentTaskType[] = ["storyboard", "frame_image_generate", "asset_parse"];

  for (const taskType of taskTypes) assert.doesNotThrow(() => assertTaskCreationAllowed(taskType));
  for (const taskType of ["page_layout", "frame_image_refine", "dialogue", "export"]) {
    assert.throws(
      () => assertTaskCreationAllowed(taskType),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "unsupported_task",
    );
  }
});

test("workbench recovery exposes every registered generation task and candidate result", () => {
  assert.deepEqual(workbenchAgentTaskTypes, [TaskType.STORYBOARD, TaskType.FRAME_IMAGE_GENERATE, TaskType.ASSET_PARSE]);
  assert.deepEqual(workbenchAgentCandidateKinds, [CandidateKind.STORYBOARD, CandidateKind.FRAME_IMAGE, CandidateKind.ASSET]);
  assert.equal(isWorkbenchAgentCandidateVisible(CandidateKind.FRAME_IMAGE, { mode: "place" }), true);
  assert.equal(isWorkbenchAgentCandidateVisible(CandidateKind.FRAME_IMAGE, { mode: "replace" }), true);
  assert.equal(isWorkbenchAgentCandidateVisible(CandidateKind.FRAME_IMAGE, { mode: "create" }), false);
  assert.equal(isWorkbenchAgentCandidateVisible(CandidateKind.ASSET, { kind: "character" }), true);
  assert.equal(isWorkbenchAgentCandidateVisible(CandidateKind.ASSET, { kind: "style" }), false);
  assert.equal(isWorkbenchAgentCandidateVisible(CandidateKind.PAGE_LAYOUT, { mode: "replace" }), false);
});

test("frame-image application stays locked to the previewed frame", () => {
  const target = { unitId: "page-01", frameId: "frame-01" };
  const operations = [
    { type: "declare_resource", resource: { kind: "image", assetId: "asset-01", assetVersionId: "version-01", mediaType: "image/png", width: 1024, height: 1024 } },
    { type: "add_layer_element", unitId: target.unitId, frameId: target.frameId, layerId: "frame-01-art", element: { id: "image-01" } },
  ];
  assert.doesNotThrow(() => assertFrameCandidateApplicationTarget(
    CandidateKind.FRAME_IMAGE,
    { type: "comic_frame", pageId: target.unitId, id: target.frameId },
    operations,
    target,
  ));
  assert.throws(() => assertFrameCandidateApplicationTarget(
    CandidateKind.FRAME_IMAGE,
    { type: "comic_frame", pageId: target.unitId, id: target.frameId },
    operations,
    { unitId: target.unitId, frameId: "frame-02" },
  ), /预览目标已经变化/);
  assert.throws(() => assertFrameCandidateApplicationTarget(
    CandidateKind.FRAME_IMAGE,
    { type: "comic_frame", pageId: target.unitId, id: target.frameId },
    [{ type: "add_layer_element", unitId: target.unitId, frameId: "frame-02" }],
    target,
  ), /候选操作与预览画格不一致/);
});

test("storyboard entry editing and frame-image generation are distinct capabilities", () => {
  const capability = getAgentCapability("storyboard.edit_single_entry");
  assert.equal(capability?.target.required, true);
  assert.deepEqual(capability?.target.types, ["comic_frame"]);
  assert.equal(capability?.target.min, 1);
  assert.equal(capability?.target.max, 1);
  assert.match(capability?.description ?? "", /StoryboardBeat|文字标题与画面描述/);
  assert.match(capability?.description ?? "", /不能处理.*格内成稿图/);
  const frameImage = getAgentCapability("frame_image.generate_or_replace");
  assert.equal(frameImage?.taskType, "frame_image_generate");
  assert.deepEqual(frameImage?.target, { required: true, types: ["comic_frame"], min: 1, max: 1 });
});

test("semantic capability manifest is versioned, serializable and shared by internal and external agents", () => {
  const first = semanticCapabilityCatalogManifest();
  const second = semanticCapabilityCatalogManifest();
  assert.equal(first.revision, 2);
  assert.equal(first.hash, second.hash);
  assert.match(first.hash, /^[a-f0-9]{64}$/);
  assert.doesNotThrow(() => JSON.stringify(first));
  assert.deepEqual(first.capabilities.map((capability) => capability.id), [
    "context.inspect_images",
    "storyboard.edit_single_entry",
    "frame_image.generate_or_replace",
    "asset.generate_character_or_scene",
  ]);
  const storyboard = first.capabilities.find((capability) => capability.id === "storyboard.edit_single_entry");
  assert.equal(storyboard?.version, 1);
  assert.equal(storyboard?.execution, "asynchronous");
  assert.equal(storyboard?.effect, "candidate");
  assert.equal(storyboard?.agentAccess.external, "execute");
  assert.deepEqual(storyboard?.executionModes, ["lantern_managed"]);
  assert.deepEqual(storyboard?.domainCapabilities, ["update_storyboard_beat", "create_frame_storyboard_beat"]);
  assert.equal(typeof storyboard?.inputSchema, "object");
  assert.equal(typeof storyboard?.outputSchema, "object");
});

test("external Candidate Apply is direct in v1 but remains controlled by one service policy", () => {
  const invocation = { actor: "external", client: { name: "codex" } } as const;
  assert.doesNotThrow(() => assertCandidateApplicationAllowed(invocation));
  assert.throws(
    () => assertCandidateApplicationAllowed(invocation, { externalAgent: "product_confirmation" }),
    /Lantern.*确认.*应用候选/,
  );
});

test("ordinary conversation stays a direct answer without creating work or exposing routing details", () => {
  const decision = guardedDecision(baseInteractionInput, {
    outcome: "respond",
    requestType: "conversation",
    goal: "介绍自己",
    message: "我是 Lantern 的 AI 漫画创作助手，可以陪你讨论故事、角色、场景和画面。",
    evidenceHandles: [],
    confidence: 0.99,
  });
  assert.equal(decision.kind, "direct_answer");
  assert.match(decision.message, /Lantern.*AI 漫画创作助手/);
  assert.doesNotMatch(decision.message, /只开放|P0|taskType|白名单|内部|暂不创建任务/);
});

test("an operation cannot be encoded as a conversational response", () => {
  assert.throws(() => interactionPlanSchema.parse({
    outcome: "respond",
    requestType: "operation",
    goal: "重新编排当前页",
    message: "请告诉我想怎么调整。",
    evidenceHandles: [],
    confidence: 0.9,
  }));
});

test("a semantic asset plan enters the registered asset task without a mode", () => {
  const decision = guardedDecision({ ...baseInteractionInput, message: "生成人物：男主，少年，帅气，内敛，校服，黑白漫画" }, {
    outcome: "invoke_capability",
    requestType: "operation",
    goal: "生成男主角色资产图片",
    capabilityId: "asset.generate_character_or_scene",
    targetHandles: [],
    arguments: { instruction: "生成一名穿校服的内敛少年男主" },
    evidenceHandles: [],
    confidence: 0.98,
  });
  assert.deepEqual(decision, {
    kind: "ready_to_run",
    capabilityId: "asset.generate_character_or_scene",
    message: "我会按当前描述生成一个可编辑的资产候选；确认后才保存到资产空间。",
    scope: "reference_only",
    taskType: "asset_parse",
  });
});

test("the Agent loop can plan again from tool output and saves resumable checkpoints", async () => {
  const checkpoints: AgentLoopCheckpoint[] = [];
  let planningSteps = 0;
  const output = await runAgentLoop({
    turnId: "turn-1",
    context: { goal: "create candidate" },
    planner: {
      async next({ toolResults }) {
        planningSteps += 1;
        if (!toolResults.length) return { kind: "tool_call", call: { id: "call-1", name: "inspect_context", input: {} } };
        return { kind: "tool_call", call: { id: "call-2", name: "create_candidate", input: toolResults[0].output } };
      },
    },
    tools: [
      { name: "inspect_context", async execute() { return { output: { target: "frame-1" }, continueLoop: true }; } },
      { name: "create_candidate", async execute(input) { return { output: { status: "available", input } }; } },
    ],
    checkpointStore: { async save(checkpoint) { checkpoints.push(checkpoint); } },
  });

  assert.equal(planningSteps, 2);
  assert.deepEqual(output, { status: "available", input: { target: "frame-1" } });
  assert.equal(checkpoints.at(-1)?.status, "completed");
  assert.equal(checkpoints.at(-1)?.toolResults.length, 2);
});

test("asset drafts use type, name and description as the complete semantic contract", () => {
  assert.deepEqual(assetDraftSchema.parse({ kind: "character", name: "林澄", description: "肩长黑发，穿浅色风衣，神态克制。" }), {
    kind: "character",
    name: "林澄",
    description: "肩长黑发，穿浅色风衣，神态克制。",
  });
  assert.throws(() => assetDraftSchema.parse({
    kind: "character",
    name: "林澄",
    description: "角色描述",
    attributes: { outfit: "浅色风衣" },
  }));
  assert.throws(() => assetDraftSchema.parse({ kind: "style", name: "水彩", description: "冷色水彩风格。" }));
});

test("multiple labeled asset references share one request contract", () => {
  assert.deepEqual(explicitWorkspaceReferencesSchema.parse([
    { objectType: "character", objectId: "asset-1", versionId: "version-1", label: "男主" },
    { objectType: "style", objectId: "asset-2", versionId: "version-2", label: "黑白漫画" },
  ]), [
    { objectType: "character", objectId: "asset-1", versionId: "version-1", label: "男主" },
    { objectType: "style", objectId: "asset-2", versionId: "version-2", label: "黑白漫画" },
  ]);
  assert.deepEqual(explicitWorkspaceReferencesSchema.parse([
    { objectType: "canvas_element", objectId: "frame-1", label: "画格 01" },
    { objectType: "canvas_element", objectId: "frame-2", label: "画格 02" },
  ]), [
    { objectType: "canvas_element", objectId: "frame-1", label: "画格 01" },
    { objectType: "canvas_element", objectId: "frame-2", label: "画格 02" },
  ]);
});

test("dialogue context accepts LCD cut-corner and page-level balloons", () => {
  assert.deepEqual(explicitDialogueReferenceSchema.parse({
    elementId: "balloon-1",
    dialogueId: "dialogue-1",
    pageId: "page-1",
    pageIndex: 0,
    balloonNumber: 1,
    text: "别回头。",
    shape: "cut_corner",
  }), {
    elementId: "balloon-1",
    dialogueId: "dialogue-1",
    pageId: "page-1",
    pageIndex: 0,
    balloonNumber: 1,
    text: "别回头。",
    shape: "cut_corner",
  });
});

test("image inspection is a read-only planner tool and requires an attachment", () => {
  const plan: InteractionPlan = {
    outcome: "invoke_capability",
    requestType: "operation",
    goal: "读取上传图片内容",
    capabilityId: "context.inspect_images",
    targetHandles: ["attachment:0"],
    arguments: {},
    evidenceHandles: ["attachment:0"],
    confidence: 0.98,
  };
  assert.deepEqual(guardInteractionPlan({ ...baseInteractionInput, imageAttachments: [{ handle: "attachment:0", label: "参考图" }] }, plan), {
    kind: "tool_call",
    capabilityId: "context.inspect_images",
    targetHandles: ["attachment:0"],
  });
  assert.equal(guardedDecision(baseInteractionInput, plan).kind, "needs_input");
});

test("image inspection guard rejects an unknown attachment handle", () => {
  const route = guardInteractionPlan({
    ...baseInteractionInput,
    imageAttachments: [{ handle: "attachment:0", label: "参考图" }],
  }, {
    outcome: "invoke_capability",
    requestType: "operation",
    goal: "读取上传图片内容",
    capabilityId: "context.inspect_images",
    targetHandles: ["attachment:99"],
    arguments: {},
    evidenceHandles: [],
    confidence: 0.98,
  });

  assert.equal(route.kind, "decision");
  if (route.kind !== "decision") assert.fail("unknown handle must not reach the tool");
  assert.equal(route.decision.kind, "needs_input");
});

test("image inspection accepts only explicitly named current-page targets with fixed image versions", () => {
  const target = {
    handle: "current-page:frame:1",
    type: "comic_frame" as const,
    label: "画格 01",
    aliases: ["画格1"],
    summary: "眼睛特写",
    pageId: "page-1",
    elementId: "frame-1",
    frameId: "frame-1",
    frameLabel: "画格 01",
    assetVersionIds: ["image-version-1"],
    dialogueIds: [],
  };
  const route = guardInteractionPlan({ ...baseInteractionInput, currentPageTargets: [target] }, {
    outcome: "invoke_capability",
    requestType: "operation",
    goal: "读取画格 01 的实际图片内容",
    capabilityId: "context.inspect_images",
    targetHandles: [target.handle],
    arguments: {},
    evidenceHandles: [target.handle],
    confidence: 0.97,
  });
  assert.deepEqual(route, { kind: "tool_call", capabilityId: "context.inspect_images", targetHandles: [target.handle] });
});

test("character design discussion remains a normal answer without a separate asset mode", () => {
  const decision = guardedDecision({ ...baseInteractionInput, message: "帮我完善男教师的角色设定" }, {
    outcome: "respond",
    requestType: "conversation",
    goal: "完善男教师角色设定",
    message: "可以把他设定成一位课堂上严厉克制、私下会默默照顾学生的教师。胖矮身形、黑色衣服和眼镜形成稳定轮廓，关键时刻的维护则表现他的外冷内热。",
    evidenceHandles: [],
    confidence: 0.96,
  });

  assert.equal(decision.kind, "direct_answer");
  assert.match(decision.message, /课堂上严厉克制/);
  assert.doesNotMatch(decision.message, /资产模式|切换模式/);
});

test("unsupported structure requests do not become a different registered task", () => {
  const decision = guardedDecision({ ...baseInteractionInput, message: "重新编排当前页" }, {
    outcome: "unsupported",
    requestType: "operation",
    goal: "重新编排当前页",
    requestedOperation: "page_layout",
    message: "当前还不能直接重新编排整页；可以先逐格完善画面描述。",
    evidenceHandles: [],
    confidence: 0.97,
  });
  assert.equal(decision.kind, "direct_answer");
  assert.match(decision.message, /不能直接重新编排整页/);
});

test("single storyboard-entry editing requires a selected comic frame and stays frame-scoped", () => {
  const plan: InteractionPlan = {
    outcome: "invoke_capability",
    requestType: "operation",
    goal: "编辑当前格的分镜条目",
    capabilityId: "storyboard.edit_single_entry",
    targetHandles: ["selection"],
    arguments: { instruction: "改写当前格的画面描述" },
    evidenceHandles: ["selection"],
    confidence: 0.99,
  };
  assert.equal(guardedDecision(baseInteractionInput, plan).kind, "needs_input");
  assert.deepEqual(guardedDecision({ ...baseInteractionInput, selection: { type: "comic_frame", id: "frame-1" } }, plan), {
    kind: "ready_to_run",
    capabilityId: "storyboard.edit_single_entry",
    message: "我会编辑目标画格的分镜条目，只更新它的标题和画面描述；应用前不会改变工作稿。",
    scope: "selected_comic_frame",
    taskType: "storyboard",
  });
});

test("equivalent storyboard-entry wording shares one semantic plan instead of keyword routes", () => {
  const plan: InteractionPlan = {
    outcome: "invoke_capability",
    requestType: "operation",
    goal: "编辑选中画格的分镜条目",
    capabilityId: "storyboard.edit_single_entry",
    targetHandles: ["selection"],
    arguments: { instruction: "改写选中画格的分镜条目" },
    evidenceHandles: ["selection"],
    confidence: 0.96,
  };
  for (const message of ["编辑当前格的分镜条目", "改写这一格的画面描述", "调整选中格的文字分镜"]) {
    assert.deepEqual(guardedDecision({
      ...baseInteractionInput,
      message,
      selection: { type: "comic_frame", id: "frame-1", label: "画格 01" },
    }, plan), {
      kind: "ready_to_run",
      capabilityId: "storyboard.edit_single_entry",
      message: "我会编辑目标画格的分镜条目，只更新它的标题和画面描述；应用前不会改变工作稿。",
      scope: "selected_comic_frame",
      taskType: "storyboard",
    });
  }
});

test("frame image regeneration uses a separate candidate task", () => {
  const decision = guardedDecision({
    ...baseInteractionInput,
    message: "重新生成当前格的画面",
    selection: { type: "comic_frame", id: "frame-1", label: "画格 01" },
  }, {
    outcome: "invoke_capability",
    requestType: "operation",
    goal: "重新生成画格 01 的格内图片",
    capabilityId: "frame_image.generate_or_replace",
    targetHandles: ["selection"],
    arguments: { instruction: "重新生成当前格的画面" },
    evidenceHandles: ["selection"],
    confidence: 0.98,
  });
  assert.deepEqual(decision, {
    kind: "ready_to_run",
    capabilityId: "frame_image.generate_or_replace",
    message: "我会为目标画格生成新的格内图片；应用前不会替换当前画面。",
    scope: "selected_comic_frame",
    taskType: "frame_image_generate",
  });
  assert.deepEqual(parseCandidatePayload("FRAME_IMAGE", {
    mode: "replace",
    assetId: "generated-frame-asset",
    assetVersionId: "generated-frame-version",
    sourceAssetVersionIds: ["previous-frame-version"],
  }), {
    mode: "replace",
    assetId: "generated-frame-asset",
    assetVersionId: "generated-frame-version",
    sourceAssetVersionIds: ["previous-frame-version"],
  });
});

test("a unique current-page storyboard or dialogue handle resolves to its owning frame without canvas selection", () => {
  const currentPageTargets: InteractionInput["currentPageTargets"] = [
    {
      handle: "current-page:storyboard:1",
      type: "storyboard_beat",
      label: "铃声之后",
      aliases: ["铃声之后"],
      summary: "铃声响起后，学生们陆续离开教室。",
      pageId: "page-1",
      pageLabel: "Page 01–02",
      frameId: "frame-1",
      frameLabel: "画格 01",
      storyboardBeatId: "beat-1",
      assetVersionIds: [],
      dialogueIds: ["dialogue-1"],
    },
    {
      handle: "current-page:dialogue:2",
      type: "speech_balloon",
      label: "对白 02",
      aliases: ["对白2", "气泡02"],
      summary: "等一下。",
      pageId: "page-1",
      pageLabel: "Page 01–02",
      elementId: "balloon-2",
      frameId: "frame-1",
      frameLabel: "画格 01",
      assetVersionIds: [],
      dialogueIds: ["dialogue-1"],
    },
  ];
  for (const targetHandle of ["current-page:storyboard:1", "current-page:dialogue:2"]) {
    const route = guardInteractionPlan({ ...baseInteractionInput, currentPageTargets }, {
      outcome: "invoke_capability",
      requestType: "operation",
      goal: "优化铃声之后的分镜条目",
      capabilityId: "storyboard.edit_single_entry",
      targetHandles: [targetHandle],
      arguments: { instruction: "优化分镜条目" },
      evidenceHandles: [targetHandle],
      confidence: 0.98,
    });
    assert.equal(route.kind, "decision");
    if (route.kind !== "decision") assert.fail("current-page target should resolve to a task decision");
    assert.deepEqual(route.targetSelection, { type: "comic_frame", id: "frame-1", pageId: "page-1", label: "Page 01–02 · 画格 01" });
    assert.equal(route.decision.kind, "ready_to_run");
  }
});

test("current-page semantic targets must resolve to exactly one owning frame", () => {
  const currentPageTargets: NonNullable<InteractionInput["currentPageTargets"]> = [
    { handle: "current-page:storyboard:1", type: "storyboard_beat", label: "眼睛特写", aliases: [], summary: "", pageId: "page-1", frameId: "frame-1", frameLabel: "画格 01", assetVersionIds: [], dialogueIds: [] },
    { handle: "current-page:storyboard:2", type: "storyboard_beat", label: "眼睛特写", aliases: [], summary: "", pageId: "page-1", frameId: "frame-2", frameLabel: "画格 02", assetVersionIds: [], dialogueIds: [] },
  ];
  const route = guardInteractionPlan({ ...baseInteractionInput, currentPageTargets }, {
    outcome: "invoke_capability",
    requestType: "operation",
    goal: "优化眼睛特写这格",
    capabilityId: "storyboard.edit_single_entry",
    targetHandles: currentPageTargets.map((target) => target.handle),
    arguments: {},
    evidenceHandles: currentPageTargets.map((target) => target.handle),
    confidence: 0.6,
  });
  assert.equal(route.kind, "decision");
  if (route.kind !== "decision") assert.fail("ambiguous targets must not reach task execution");
  assert.equal(route.decision.kind, "needs_input");
  assert.match(route.decision.message, /多个画格/);
});
