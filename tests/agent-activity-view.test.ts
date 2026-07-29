import assert from "node:assert/strict";
import test from "node:test";
import type { AgentActivityEvent, AgentActivityGroup } from "@lantern/shared";
import {
  agentActivityFeedNeedsAttention,
  agentActivityEventDescription,
  agentActivityEventDetails,
  agentActivityEventNavigation,
  agentActivityPollIntervalMs,
  agentActivityStatus,
  appendAgentActivityGroups,
  mergeAgentActivityGroups,
} from "../apps/web/app/lib/agent-activity-view";

function event(overrides: Partial<AgentActivityEvent> = {}): AgentActivityEvent {
  return {
    id: "event-1",
    toolName: "lantern_edit",
    eventType: "frame.update",
    status: "succeeded",
    projection: {
      version: 1,
      kind: "frame.update",
      action: "frame.update",
      targets: [{ type: "comic_frame", label: "Page 2 · 画格 01", assetVersionIds: [] }],
    },
    startedAt: "2026-07-28T06:00:00.000Z",
    completedAt: "2026-07-28T06:00:01.000Z",
    ...overrides,
  };
}

function group(id: string, overrides: Partial<AgentActivityGroup> = {}): AgentActivityGroup {
  return {
    id,
    sourceType: "external_mcp",
    title: `Task ${id}`,
    status: "completed",
    startedAt: "2026-07-28T06:00:00.000Z",
    updatedAt: "2026-07-28T06:00:01.000Z",
    completedAt: "2026-07-28T06:00:01.000Z",
    eventCount: 1,
    events: [event()],
    ...overrides,
  };
}

test("activity refresh replaces changed groups without dropping loaded older records", () => {
  const current = [group("new", { title: "old title" }), group("older")];
  const incoming = [group("new", { title: "new title" }), group("latest")];
  assert.deepEqual(
    mergeAgentActivityGroups(current, incoming).map((item) => [item.id, item.title]),
    [["new", "new title"], ["latest", "Task latest"], ["older", "Task older"]],
  );
});

test("loading earlier records appends without duplicating current records", () => {
  assert.deepEqual(
    appendAgentActivityGroups([group("new")], [group("new"), group("older")]).map((item) => item.id),
    ["new", "older"],
  );
});

test("activity polling is fast only while a group is running", () => {
  assert.equal(agentActivityPollIntervalMs([]), 10_000);
  assert.equal(agentActivityPollIntervalMs([group("completed")]), 10_000);
  assert.equal(agentActivityPollIntervalMs([group("running", { status: "running" })]), 1_000);
});

test("running and awaiting-review groups request attention on initial load", () => {
  assert.equal(agentActivityFeedNeedsAttention([group("completed")]), false);
  assert.equal(agentActivityFeedNeedsAttention([group("running", { status: "running" })]), true);
  assert.equal(agentActivityFeedNeedsAttention([group("proposal", {
    proposal: { id: "proposal-1", status: "available", reviewPath: "/reviews/proposal-1" },
  })]), true);
});

test("proposal status is presented with text instead of color alone", () => {
  assert.equal(agentActivityStatus(group("proposal", {
    proposal: { id: "proposal-1", status: "available", reviewPath: "/reviews/proposal-1" },
  })).label, "待确认");
  assert.equal(agentActivityStatus(group("timeout", { status: "timed_out" })).label, "已超时");
  assert.equal(agentActivityStatus(group("applied", {
    proposal: {
      id: "proposal-2",
      status: "applied",
      reviewPath: "/reviews/proposal-2",
      acceptedWorkingRevision: 3,
      acceptedSnapshotId: "snapshot-3",
    },
  })).label, "已完成");
});

test("event descriptions stay one-line friendly and proposal events resolve navigation", () => {
  assert.equal(
    agentActivityEventDescription(event()),
    "调整了画格 · Page 2 · 画格 01",
  );
  const proposalEvent = event({
    projection: {
      version: 1,
      kind: "proposal_created",
      action: "agent_draft.finish",
      targets: [],
    },
  });
  assert.deepEqual(
    agentActivityEventNavigation(proposalEvent, group("proposal", {
      events: [proposalEvent],
      proposal: { id: "proposal-1", status: "available", reviewPath: "/reviews/proposal-1" },
    })),
    { kind: "change_proposal", proposalId: "proposal-1" },
  );
  const appliedGroup = group("applied", {
    events: [proposalEvent],
    proposal: {
      id: "proposal-2",
      status: "applied",
      reviewPath: "/reviews/proposal-2",
      acceptedWorkingRevision: 3,
      acceptedSnapshotId: "snapshot-3",
    },
  });
  assert.equal(
    agentActivityEventDescription(proposalEvent, appliedGroup),
    "已应用并保存为正式版本",
  );
  assert.deepEqual(
    agentActivityEventNavigation(proposalEvent, appliedGroup),
    { kind: "saved_snapshot", snapshotId: "snapshot-3" },
  );
  assert.equal(
    agentActivityEventDescription(event({
      projection: {
        version: 1,
        kind: "system_notice",
        action: "activity.timed_out",
        targets: [],
      },
    })),
    "未检测到新的 Agent 活动，任务已标记为超时",
  );
});

test("event details expose semantic audit fields without leaking sensitive result data", () => {
  const details = agentActivityEventDetails(event({
    capabilityId: "comic.frame.update",
    toolName: "lantern_edit",
    projection: {
      version: 1,
      kind: "frame.update",
      action: "frame.update",
      targets: [{
        type: "comic_frame",
        label: "Page 2 · 画格 01",
        assetVersionIds: ["asset-version-1"],
      }],
      data: {
        changed: true,
        bounds: { x: 10, y: 20 },
        accessToken: "should-not-appear",
        previewUrl: "https://signed.example/image",
        nested: { objectKey: "private/object", preserved: "visible" },
      },
    },
  }));
  const rendered = details.map((detail) => `${detail.label}:${detail.value}`).join("\n");

  assert.match(rendered, /comic\.frame\.update/);
  assert.match(rendered, /lantern_edit/);
  assert.match(rendered, /Page 2 · 画格 01/);
  assert.match(rendered, /asset-version-1/);
  assert.match(rendered, /"changed": true/);
  assert.match(rendered, /"preserved": "visible"/);
  assert.doesNotMatch(rendered, /should-not-appear/);
  assert.doesNotMatch(rendered, /signed\.example/);
  assert.doesNotMatch(rendered, /private\/object/);
});
