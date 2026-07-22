import { z } from "zod";

export type AgentTaskType = "storyboard" | "frame_image_generate" | "asset_parse";
export type AgentCapabilityExecution = "synchronous" | "asynchronous";
export type AgentCapabilityEffect = "observe" | "resource_mutation" | "direct_change" | "candidate";
export type AgentCapabilityRisk = "low" | "medium" | "high";
export type AgentCapabilityAccess = "disabled" | "observe" | "preview" | "execute";
export type AgentCapabilityActor = "internal" | "external";
export type AgentCapabilityContextProfile = "visual_observation" | "composition_observation" | "single_frame_generation" | "asset_generation";

export type SemanticCapabilityManifest = {
  id: string;
  version: number;
  execution: AgentCapabilityExecution;
  taskType?: AgentTaskType;
  description: string;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  target: {
    required: boolean;
    types: string[];
    min: number;
    max: number;
  };
  scope?: "selected_comic_frame" | "reference_only";
  contextProfile?: AgentCapabilityContextProfile;
  effect: AgentCapabilityEffect;
  executionModes: Array<"deterministic" | "lantern_managed" | "external_result">;
  risk: AgentCapabilityRisk;
  agentAccess: {
    internal: AgentCapabilityAccess;
    external: AgentCapabilityAccess;
  };
  idempotency: "required" | "optional";
  domainCapabilities: string[];
  confirmation: "none" | "explicit";
  userMessage: string;
  missingTargetMessage?: string;
};
