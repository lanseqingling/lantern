import type { z } from "zod";
import type {
  ComicDocument,
  SnapshotEnvelope,
  StoryboardBeat,
  WorkingEnvelope,
} from "./lcd/types";
import { presentationUnitLayoutSchema, workspaceChangeSetSchema, workspaceCommandSchema } from "./workspace-schema";

export type PresentationUnitLayout = z.infer<typeof presentationUnitLayoutSchema>;

/** Internal write vocabulary produced by editor capabilities and persisted in ChangeSets. */
export type WorkspaceCommand = z.infer<typeof workspaceCommandSchema>;

// Kept as a source alias while application modules migrate terminology.
export type WorkspaceOperation = WorkspaceCommand;

/** `operations` remains a read-only compatibility field for the one-time legacy data migration. */
export type WorkspaceChangeSet = z.infer<typeof workspaceChangeSetSchema>;

export function changeSetCommands(changeSet: WorkspaceChangeSet): WorkspaceCommand[] {
  return changeSet.commands ?? changeSet.operations ?? [];
}

/** Asset heads include chapter assets not currently placed in the LCD. */
export function mergeAssetVersionHeads(current: Record<string, string>, resources: Array<{ assetId: string; assetVersionId: string }>) {
  return { ...current, ...Object.fromEntries(resources.map((resource) => [resource.assetId, resource.assetVersionId])) };
}

export type CandidateKind = "storyboard" | "page_layout" | "frame_image" | "frame_image_patch" | "asset" | "dialogue";
export type CandidateScope =
  | { type: "chapter" }
  | { type: "presentation_unit"; unitId: string }
  | { type: "frames"; unitId: string; frameIds: string[] }
  | { type: "frame"; unitId: string; frameId: string };

export type Candidate = {
  id: string;
  kind: CandidateKind;
  title: string;
  changeSummary: string;
  targetLabel: string;
  baseRevision: number;
  status: "available" | "saved" | "applied" | "reverted" | "discarded" | "stale";
  scope?: CandidateScope;
  commands?: WorkspaceCommand[];
  document?: ComicDocument;
  metadata?: Record<string, string>;
};

export type PageVariant = {
  id: string;
  projectId: string;
  unitId: string;
  name: string;
  kind: "layout_only" | "complete_unit" | "partial_frames";
  baseRevision: number;
  scope: CandidateScope;
  commands: WorkspaceCommand[];
  thumbnailAssetVersionId?: string;
  createdAt: string;
  sourceCandidateId?: string;
  status: "saved" | "applied" | "stale";
};

export type ReferencePlacement = {
  id: string;
  kind: "character" | "scene" | "prop" | "style" | "sketch" | "reference_image" | "generated_image";
  name: string;
  detail: string;
  imageSrc: string;
  localAssetId?: string;
  localAssetSource?: "upload" | "generated";
  assetId?: string;
  assetVersionId?: string;
  libraryStatus?: "canvas_only" | "library";
  x: number;
  y: number;
  zoom: number;
  zIndex?: number;
  collapsed: boolean;
  pinned: boolean;
};

export type AssetSummary = {
  id: string;
  kind: "character" | "scene" | "style" | "prop" | "reference_image" | "sketch" | "generated_image";
  name: string;
  description: string;
  versionId?: string;
  contentUrl?: string;
  attributes?: Record<string, string>;
  versions?: Array<{ id: string; version: number; contentUrl?: string; width?: number; height?: number; createdAt?: string }>;
  canvasListItemId?: string;
  libraryStatus?: "canvas_only" | "library";
  pinned?: boolean;
  sortIndex?: number;
};

export type WorkbenchFixture = {
  working: WorkingEnvelope;
  snapshot?: SnapshotEnvelope;
  storyboardBeats: StoryboardBeat[];
  references: ReferencePlacement[];
};
