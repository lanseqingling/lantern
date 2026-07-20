import { CandidateKind, TaskType } from "@prisma/client";

export const workbenchAgentTaskTypes = [
  TaskType.STORYBOARD,
  TaskType.FRAME_IMAGE_GENERATE,
  TaskType.ASSET_PARSE,
] as const;

export const workbenchAgentCandidateKinds = [
  CandidateKind.STORYBOARD,
  CandidateKind.FRAME_IMAGE,
  CandidateKind.ASSET,
] as const;

export function isWorkbenchAgentCandidateVisible(kind: CandidateKind, payload: Record<string, unknown>) {
  if (kind === CandidateKind.ASSET) return payload.kind === "character" || payload.kind === "scene";
  if (kind === CandidateKind.FRAME_IMAGE) return payload.mode === "place" || payload.mode === "replace";
  if (kind === CandidateKind.STORYBOARD) return payload.mode === "create" || payload.mode === "replace";
  return false;
}
