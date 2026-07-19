import assert from "node:assert/strict";
import { planInteraction, type InteractionInput, type PlannedInteraction } from "../packages/agent-runtime/src/orchestrator";

type ProbeCase = {
  name: string;
  input: InteractionInput;
  expect: (result: PlannedInteraction) => void;
};

const contextSummary = {
  creativeBaseline: {
    comic: { title: "夏日来信", format: "page", readingDirection: "ltr" },
    storyCore: "少女在旧信中寻找失踪父亲留下的线索。",
    world: { summary: "当代校园与临海小城。" },
    visualStyle: { summary: "克制的黑白漫画，细线条与高反差光影。" },
  },
  currentView: { unitIds: ["page-01", "page-02"], label: "Page 01–02", physicalPageNumbers: [1, 2] },
  currentPage: { id: "page-01", pageIndex: 0, kind: "single_page", comicFrameCount: 4 },
  currentPageTargets: [{
    handle: "current-page:storyboard:1",
    type: "storyboard_beat",
    label: "铃声之后",
    aliases: ["铃声之后", "画格1"],
    summary: "放学铃响起，教室里的人陆续离开，只剩夏葵看着信封。",
    pageId: "page-01",
    frameId: "frame-01",
    frameLabel: "画格 01",
    storyboardBeatId: "beat-01",
    assetVersionIds: [],
    dialogueIds: [],
  }],
  currentViewLcd: [
    { unit: { id: "page-01", name: "Page 01", kind: "single_page", frameCount: 4 } },
    { unit: { id: "page-02", name: "Page 02", kind: "single_page", frameCount: 4 } },
  ],
  recentConversation: [],
};

const baseInput: InteractionInput = {
  message: "",
  selection: { type: "none" },
  contextSummary,
  imageAttachments: [],
  observations: [],
};

function expectPlan(outcome: string, capabilityId?: string) {
  return (result: PlannedInteraction) => {
    assert.equal(result.trace.plan.outcome, outcome);
    if (capabilityId) {
      assert.equal(result.trace.plan.outcome, "invoke_capability");
      if (result.trace.plan.outcome === "invoke_capability") assert.equal(result.trace.plan.capabilityId, capabilityId);
    }
  };
}

const cases: ProbeCase[] = [
  {
    name: "identity question stays conversational",
    input: { ...baseInput, message: "你是谁" },
    expect: expectPlan("respond"),
  },
  {
    name: "explicit storyboard entry edit enters the text candidate task",
    input: {
      ...baseInput,
      message: "改写这一格的分镜条目，保留安静的课堂气氛",
      selection: { type: "comic_frame", id: "frame-local", pageId: "page-local", label: "画格 01" },
    },
    expect: expectPlan("invoke_capability", "storyboard.edit_single_entry"),
  },
  {
    name: "a named current-page storyboard resolves without canvas selection",
    input: { ...baseInput, message: "优化铃声之后的分镜条目" },
    expect(result) {
      expectPlan("invoke_capability", "storyboard.edit_single_entry")(result);
      assert.equal(result.route.kind, "decision");
      if (result.route.kind === "decision") assert.deepEqual(result.route.targetSelection, { type: "comic_frame", id: "frame-01", pageId: "page-01", label: "画格 01" });
    },
  },
  {
    name: "frame image redraw enters the image candidate task",
    input: {
      ...baseInput,
      message: "重新生成当前格的画面",
      selection: { type: "comic_frame", id: "frame-local", pageId: "page-local", label: "画格 01" },
    },
    expect: expectPlan("invoke_capability", "frame_image.generate_or_replace"),
  },
  {
    name: "explicit character image request enters asset generation",
    input: { ...baseInput, message: "生成人物：男主，少年，帅气内敛，穿校服，黑白漫画" },
    expect: expectPlan("invoke_capability", "asset.generate_character_or_scene"),
  },
  {
    name: "character discussion does not create an asset task",
    input: { ...baseInput, message: "帮我完善男教师的角色设定，让外冷内热更可信" },
    expect: expectPlan("respond"),
  },
  {
    name: "unregistered page layout request remains unsupported",
    input: { ...baseInput, message: "重新编排当前页" },
    expect(result) {
      assert.equal(result.trace.plan.outcome, "unsupported");
      if (result.trace.plan.outcome !== "unsupported") return;
      assert.match(result.trace.plan.message, /当前.*不能|暂时.*不能|目前.*不能/);
      assert.doesNotMatch(result.trace.plan.message, /Page 03|Page 04|画格 09|画格 10|画格 11/);
    },
  },
  {
    name: "image question requests visual evidence first",
    input: {
      ...baseInput,
      message: "这张图里说了什么？",
      imageAttachments: [{ handle: "attachment:0", label: "上传图片" }],
    },
    expect: expectPlan("invoke_capability", "context.inspect_images"),
  },
  {
    name: "image observation is used for the final answer",
    input: {
      ...baseInput,
      message: "这张图里说了什么？",
      imageAttachments: [{ handle: "attachment:0", label: "上传图片" }],
      observations: [{ tool: "context.inspect_images", output: { type: "visual_evidence", content: "图片中的纸条写着：放学后在旧车站见。" } }],
    },
    expect: expectPlan("respond"),
  },
];

for (const probe of cases) {
  const result = await planInteraction(probe.input);
  probe.expect(result);
  const capability = result.trace.plan.outcome === "invoke_capability" ? ` ${result.trace.plan.capabilityId}` : "";
  console.log(`PASS ${probe.name}: ${result.trace.plan.outcome}${capability} [${result.trace.prompt.version}/${result.trace.prompt.hash}]`);
}
