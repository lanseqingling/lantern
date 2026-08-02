import { randomUUID } from "node:crypto";
import { planEditorCapability, type EditorCapabilityId } from "@lantern/editor-core";
import { AppError } from "@lantern/server/errors";
import {
  assertAgentCapabilityAccess,
  getAgentCapability,
  listAgentCapabilities,
  type AgentCapabilityDescriptor,
} from "./capability-registry";
import type { ExternalDirectChangeEnvelope } from "./external-edit-contract";
import {
  executeExternalDirectChange,
  type ExternalDirectChangeContext,
} from "./external-edit-service";
import { isPageCapabilityId } from "./page-capabilities";

type ParsedPageInput = Record<string, unknown> & ExternalDirectChangeEnvelope;

function directChangeEnvelope(input: ParsedPageInput): ExternalDirectChangeEnvelope {
  return {
    scope: input.scope,
    targetHandles: input.targetHandles,
    expectedRevision: input.expectedRevision,
    idempotencyKey: input.idempotencyKey,
    ...(input.confirmedTargetHandles ? { confirmedTargetHandles: input.confirmedTargetHandles } : {}),
  };
}

function targetPageIds(context: ExternalDirectChangeContext) {
  return context.targets.map(({ target }) => {
    if (target.type !== "presentation_unit" || !target.pageId) {
      throw new AppError("invalid_target_type", "页面能力只能使用页面上下文返回的 presentation_unit handle。", 422);
    }
    return target.pageId;
  });
}

function planDomainCapability(
  id: EditorCapabilityId,
  input: unknown,
  context: ExternalDirectChangeContext,
) {
  try {
    return planEditorCapability(id, input, {
      fixture: context.fixture,
      createId: (prefix) => `${prefix}-${randomUUID()}`,
      actor: "external_agent",
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "invalid_page_edit",
      error instanceof Error ? error.message : "页面结构不允许这次修改。",
      422,
    );
  }
}

function pageSummary(unit: {
  name?: string;
  kind: string;
  pageRole: string;
  surfaces: Array<{ role: string }>;
}) {
  return {
    name: unit.name ?? null,
    kind: unit.kind,
    pageRole: unit.pageRole,
    surfaceRoles: unit.surfaces.map((surface) => surface.role),
  };
}

function pagePlan(
  capability: AgentCapabilityDescriptor,
  parsed: ParsedPageInput,
  context: ExternalDirectChangeContext,
) {
  const pageIds = targetPageIds(context);
  if (capability.id === "page.create") {
    const pageRole = parsed.pageRole as "story" | "cover" | "interlude";
    const plan = planDomainCapability("create_page", {
      pageRole,
      ...(pageRole === "cover" ? {} : {
        relativeToUnitId: pageIds[0],
        side: parsed.side,
      }),
      ...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
    }, context);
    const created = plan.commands.find((command) => command.type === "add_presentation_unit");
    if (!created || created.type !== "add_presentation_unit") {
      throw new AppError("capability_contract_error", "页面创建能力没有返回新页面。", 500);
    }
    return {
      commands: plan.commands,
      data: {
        action: "created",
        page: pageSummary(created.unit),
        readingPosition: (created.readingIndex ?? context.fixture.working.document.reading.unitOrder.length) + 1,
      },
    };
  }
  if (capability.id === "page.create_spread") {
    const plan = planDomainCapability("create_spread", {
      relativeToUnitId: pageIds[0],
      side: parsed.side,
      ...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
    }, context);
    const created = plan.commands.find((command) => command.type === "add_presentation_unit");
    if (!created || created.type !== "add_presentation_unit") {
      throw new AppError("capability_contract_error", "跨页创建能力没有返回真正双页。", 500);
    }
    return {
      commands: plan.commands,
      data: {
        action: "spread_created",
        page: pageSummary(created.unit),
        readingPosition: (created.readingIndex ?? context.fixture.working.document.reading.unitOrder.length) + 1,
      },
    };
  }
  if (capability.id === "page.rename") {
    const plan = planDomainCapability("update_presentation_unit", {
      unitId: pageIds[0],
      name: parsed.name,
    }, context);
    return {
      commands: plan.commands,
      data: { action: "renamed", name: String(parsed.name).trim() || null },
    };
  }
  if (capability.id === "page.duplicate") {
    const plan = planDomainCapability("duplicate_presentation_unit", { unitId: pageIds[0] }, context);
    const created = plan.commands.find((command) => command.type === "add_presentation_unit");
    if (!created || created.type !== "add_presentation_unit") {
      throw new AppError("capability_contract_error", "页面复制能力没有返回新页面。", 500);
    }
    return {
      commands: plan.commands,
      data: {
        action: "duplicated",
        page: pageSummary(created.unit),
        readingPosition: (created.readingIndex ?? 0) + 1,
      },
    };
  }
  if (capability.id === "page.move") {
    const plan = planDomainCapability("move_presentation_unit_to", {
      unitId: pageIds[0],
      relativeToUnitId: pageIds[1],
      side: parsed.side,
    }, context);
    return {
      commands: plan.commands,
      data: { action: "moved", relativeSide: parsed.side },
    };
  }
  if (capability.id === "page.delete") {
    const plan = planDomainCapability("delete_presentation_unit", { unitId: pageIds[0] }, context);
    return {
      commands: plan.commands,
      data: { action: "deleted" },
    };
  }
  if (capability.id === "page.merge_spread") {
    const order = context.fixture.working.document.reading.unitOrder;
    const orderedPageIds = [...pageIds].sort((left, right) => order.indexOf(left) - order.indexOf(right));
    const plan = planDomainCapability("merge_pages_to_spread", {
      unitId: orderedPageIds[0],
      nextUnitId: orderedPageIds[1],
    }, context);
    const created = plan.commands.find((command) => command.type === "add_presentation_unit");
    if (!created || created.type !== "add_presentation_unit") {
      throw new AppError("capability_contract_error", "双页合并能力没有返回真正双页。", 500);
    }
    return {
      commands: plan.commands,
      data: {
        action: "merged_to_spread",
        page: pageSummary(created.unit),
        readingPosition: (created.readingIndex ?? 0) + 1,
      },
    };
  }
  if (capability.id === "page.split_spread") {
    const plan = planDomainCapability("split_spread_to_pages", { unitId: pageIds[0] }, context);
    const created = plan.commands.filter((command) => command.type === "add_presentation_unit");
    return {
      commands: plan.commands,
      data: {
        action: "split_spread",
        pages: created.map((command) => pageSummary(command.unit)),
        readingPosition: created.length ? (created[0]!.readingIndex ?? 0) + 1 : undefined,
      },
    };
  }
  throw new AppError("capability_not_available", "该页面能力当前没有同步执行器。", 404);
}

export function listExternalPageCapabilities() {
  return listAgentCapabilities().filter((capability) =>
    capability.execution === "synchronous"
    && capability.agentAccess.external !== "disabled"
    && isPageCapabilityId(capability.id));
}

export async function invokeExternalPageCapability(
  ownerUserId: string,
  capabilityId: string,
  input: unknown,
) {
  const capability = getAgentCapability(capabilityId);
  if (!capability || capability.execution !== "synchronous" || !isPageCapabilityId(capability.id)) {
    throw new AppError("capability_not_available", "该 Lantern 页面能力当前未向外部 Agent 开放。", 404);
  }
  assertAgentCapabilityAccess(capability, "external");
  const parsed = capability.inputSchema.parse(input) as ParsedPageInput;
  return executeExternalDirectChange({
    ownerUserId,
    capability,
    envelope: directChangeEnvelope(parsed),
    plan: (context) => pagePlan(capability, parsed, context),
  });
}
