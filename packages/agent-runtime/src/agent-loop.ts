/**
 * Transport-neutral Agent loop. The loop supports repeated planning, tool
 * observations and durable checkpoints without encoding business workflows.
 * Future workflow and sub-Agent tools plug into the same registry.
 */
export type AgentToolCall = {
  id: string;
  name: string;
  input: unknown;
};

export type AgentToolResult = {
  callId: string;
  toolName: string;
  output: unknown;
};

export type AgentPlanStep =
  | { kind: "tool_call"; call: AgentToolCall }
  | { kind: "complete"; output: unknown };

export type AgentLoopCheckpoint = {
  turnId: string;
  step: number;
  status: "planning" | "running_tool" | "completed" | "failed";
  toolResults: AgentToolResult[];
  updatedAt: string;
};

export type AgentPlanner<TContext> = {
  next(input: {
    turnId: string;
    context: TContext;
    toolResults: AgentToolResult[];
    step: number;
  }): Promise<AgentPlanStep>;
};

export type AgentTool = {
  name: string;
  execute(input: unknown, runtime: { turnId: string; step: number }): Promise<{ output: unknown; continueLoop?: boolean }>;
};

export type AgentCheckpointStore = {
  save(checkpoint: AgentLoopCheckpoint): Promise<void>;
};

export async function runAgentLoop<TContext>(input: {
  turnId: string;
  context: TContext;
  planner: AgentPlanner<TContext>;
  tools: AgentTool[];
  checkpointStore?: AgentCheckpointStore;
  maxSteps?: number;
}) {
  const registry = new Map(input.tools.map((tool) => [tool.name, tool]));
  const toolResults: AgentToolResult[] = [];
  const maxSteps = input.maxSteps ?? 8;
  const save = async (step: number, status: AgentLoopCheckpoint["status"]) => input.checkpointStore?.save({
    turnId: input.turnId,
    step,
    status,
    toolResults: structuredClone(toolResults),
    updatedAt: new Date().toISOString(),
  });

  let currentStep = 0;
  try {
    for (let step = 0; step < maxSteps; step += 1) {
      currentStep = step;
      await save(step, "planning");
      const plan = await input.planner.next({ turnId: input.turnId, context: input.context, toolResults, step });
      if (plan.kind === "complete") {
        await save(step, "completed");
        return plan.output;
      }
      const tool = registry.get(plan.call.name);
      if (!tool) throw new Error(`AGENT_TOOL_NOT_REGISTERED:${plan.call.name}`);
      await save(step, "running_tool");
      const result = await tool.execute(plan.call.input, { turnId: input.turnId, step });
      toolResults.push({ callId: plan.call.id, toolName: plan.call.name, output: result.output });
      if (!result.continueLoop) {
        await save(step, "completed");
        return result.output;
      }
    }
    throw new Error(`AGENT_MAX_STEPS_EXCEEDED:${maxSteps}`);
  } catch (error) {
    await save(currentStep, "failed").catch(() => undefined);
    throw error;
  }
}
