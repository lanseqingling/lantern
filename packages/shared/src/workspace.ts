import type {
  BalloonElement,
  ComicDocument,
  Frame,
  FrameLayer,
  FrameReadingEntry,
  Geometry,
  LocalTransform,
  NormalizedRect,
  PageSurface,
  PresentationUnit,
  SnapshotEnvelope,
  StoryboardBeat,
  WorkingEnvelope,
} from "./lcd/types";

export type PresentationUnitLayout = {
  canvas?: PresentationUnit["canvas"];
  surfaces?: PageSurface[];
  frames: Array<Pick<Frame, "id" | "geometry" | "zIndex"> & Partial<Pick<Frame, "border" | "shape" | "mask">>>;
  readingSequence: FrameReadingEntry[];
  layoutPolicy?: PresentationUnit["layoutPolicy"];
};

/** Public v0.4 write vocabulary. UI and Agent both submit these commands. */
export type WorkspaceCommand =
  | { type: "replace_chapter_presentation"; document: ComicDocument }
  | { type: "replace_chapter_layout"; document: ComicDocument }
  | { type: "replace_storyboard_beats"; storyboardBeats: WorkbenchFixture["storyboardBeats"] }
  | { type: "create_frame_storyboard_beat"; unitId: string; frameId: string; storyboardBeat: StoryboardBeat }
  | { type: "add_presentation_unit"; unit: PresentationUnit; readingIndex?: number }
  | { type: "move_frame"; unitId: string; frameId: string; position: { x: number; y: number } }
  | { type: "resize_frame"; unitId: string; frameId: string; geometry: Geometry }
  | { type: "reorder_frame"; unitId: string; frameId: string; zIndex: number }
  | { type: "set_frame_style"; unitId: string; frameId: string; border?: Frame["border"]; shape?: Frame["shape"]; mask?: Frame["mask"] }
  | { type: "replace_presentation_layout"; unitId: string; expectedFrameIds: string[]; layout: PresentationUnitLayout }
  | { type: "add_frame"; unitId: string; frame: Frame; readingIndex?: number }
  | { type: "remove_frame"; unitId: string; frameId: string }
  | { type: "set_art_crop"; unitId: string; frameId: string; layerId: string; elementId: string; crop: NormalizedRect }
  | { type: "set_element_transform"; unitId: string; frameId?: string; layerId: string; elementId: string; transform: LocalTransform | Geometry }
  | { type: "add_layer_element"; unitId: string; frameId: string; layerId: string; element: FrameLayer["elements"][number] }
  | { type: "remove_layer_element"; unitId: string; frameId: string; layerId: string; elementId: string }
  | { type: "duplicate_layer_element"; unitId: string; frameId: string; layerId: string; elementId: string; newElementId: string }
  | { type: "reorder_layer"; unitId: string; frameId: string; layerId: string; zIndex: number }
  | { type: "update_balloon"; unitId: string; frameId: string; layerId: string; elementId: string; changes: Partial<Pick<BalloonElement, "transform" | "tailTarget" | "shape" | "style" | "overflow">> }
  | { type: "update_dialogue"; dialogueId: string; content: string }
  | { type: "update_storyboard_beat"; storyboardBeatId: string; patch: Partial<Pick<StoryboardBeat, "title" | "description">> };

// Kept as a source alias while application modules migrate terminology.
export type WorkspaceOperation = WorkspaceCommand;

export type WorkspaceChangeSet = {
  id: string;
  projectId: string;
  baseRevision: number;
  source: "manual" | "candidate" | "undo" | "redo" | "migration";
  sourceCandidateId?: string;
  commands?: WorkspaceCommand[];
  /** Read-only compatibility during the one-time v0.3 data migration. */
  operations?: WorkspaceCommand[];
};

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
