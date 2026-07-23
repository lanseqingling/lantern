import { normalizeStoryboardBeats, type AssetSummary, type Candidate, type WorkbenchFixture } from "@lantern/shared";
import { createInitialFixture } from "@lantern/demo-runtime";
import { uiCopy } from "@/app/lib/ui-copy";

export type Selection = {
  type: "none" | "presentation_unit" | "comic_frame" | "image" | "text" | "speech_balloon" | "reference_card" | "storyboard_beat";
  id?: string;
  pageId?: string;
  label: string;
};

export type AgentMessage = {
  id: string;
  role: "user" | "agent";
  kind: "plain" | "question" | "task" | "candidate" | "failed" | "canceled";
  text: string;
  attachments?: Array<{ id: string; name: string; imageUrl: string }>;
  scope?: string;
  options?: string[];
  candidateId?: string;
  taskName?: string;
  taskId?: string;
  resolved?: boolean;
  instruction?: string;
  selection?: Selection;
  explicitReferences?: Array<{ objectType: string; objectId: string; versionId?: string; label?: string }>;
};

export type ActiveTaskLike = {
  id: string;
  name: string;
  label: string;
  scope: string;
  progress: number;
  status: "running" | "failed" | "canceled";
  stage?: "preparing" | "queued" | "generating" | "validating" | "saving";
  targetLabel?: string;
  createdAt?: string;
  elapsedSeconds?: number;
  selection?: Selection;
};

export type PersistedWorkbench = {
  fixture: WorkbenchFixture;
  candidates: Candidate[];
  messages: AgentMessage[];
  currentPageIndex: number;
  assets?: AssetSummary[];
  conversations?: Array<{ id: string; title: string; createdAt: string; updatedAt: string }>;
  uiVersion?: number;
};

export const defaultMessages: AgentMessage[] = [
  {
    id: "agent-initial-guide",
    role: "agent",
    kind: "plain",
    text: uiCopy.workbench.chat.initialGuide,
  },
];

const STORAGE_KEY = "lantern-demo-workbench-v1";
const CURRENT_UI_VERSION = 8;

export function createDemoWorkbench(): PersistedWorkbench {
  const fixture = createInitialFixture();
  return {
    fixture,
    candidates: [],
    messages: structuredClone(defaultMessages),
    currentPageIndex: 0,
    assets: fixture.references.map((reference) => ({
      id: reference.assetId ?? reference.id,
      kind: reference.kind,
      name: reference.name,
      description: reference.detail,
      versionId: reference.assetVersionId,
      contentUrl: reference.imageSrc,
    })),
    uiVersion: CURRENT_UI_VERSION,
  };
}

export function createBlankWorkbench(): PersistedWorkbench {
  const createdAt = new Date(0).toISOString();
  return {
    fixture: {
      working: {
        documentId: "loading-document",
        chapterId: "loading-chapter",
        projectId: "loading-project",
        createdAt,
        state: "working",
        revision: 0,
        document: {
          protocolVersion: "lcd-0.4",
          comicId: "loading-comic",
          chapterId: "loading-chapter",
          format: "page",
          reading: { direction: "ltr", viewer: "paged", unitOrder: ["loading-page"], showPageNumber: true },
          units: [{
            id: "loading-page",
            kind: "single_page",
            canvas: { width: 720, height: 1080, background: { color: "#ffffff" } },
            surfaces: [{ id: "loading-surface", role: "single", geometry: { x: 0, y: 0, width: 720, height: 1080 }, pageNumber: 1 }],
            frames: [],
            overlayLayers: [],
            readingSequence: [],
            layoutPolicy: { frameOverlap: "forbid", defaultOverflow: "clip" },
          }],
          resources: [],
          dialogues: [],
        },
      },
      storyboardBeats: [],
      references: [],
    },
    candidates: [],
    messages: [],
    currentPageIndex: 0,
    assets: [],
    conversations: [],
    uiVersion: CURRENT_UI_VERSION,
  };
}

function normalizeFixture(fixture: WorkbenchFixture): WorkbenchFixture {
  const next = structuredClone(fixture);
  next.storyboardBeats = normalizeStoryboardBeats(next.storyboardBeats);
  return next;
}

function normalizeWorkbench(state: PersistedWorkbench): PersistedWorkbench {
  const fromUiVersion = state.uiVersion ?? 0;
  const shouldResetDemoAgentState = fromUiVersion < CURRENT_UI_VERSION;
  return {
    ...state,
    fixture: normalizeFixture(state.fixture),
    messages: shouldResetDemoAgentState ? structuredClone(defaultMessages) : state.messages,
    candidates: shouldResetDemoAgentState ? [] : state.candidates,
    uiVersion: CURRENT_UI_VERSION,
  };
}

function hasReadableWorkingDocument(state: PersistedWorkbench) {
  const document = state.fixture?.working?.document;
  return Boolean(
    document
      && document.protocolVersion === "lcd-0.4"
      && Array.isArray(document.units)
      && Array.isArray(document.reading?.unitOrder),
  );
}

export function loadDemoWorkbench(): PersistedWorkbench {
  if (typeof window === "undefined") return createDemoWorkbench();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDemoWorkbench();
    const normalized = normalizeWorkbench(JSON.parse(raw) as PersistedWorkbench);
    // Demo storage is never accepted unless it contains a complete current LCD.
    return hasReadableWorkingDocument(normalized) ? normalized : createDemoWorkbench();
  } catch {
    return createDemoWorkbench();
  }
}

export function persistDemoWorkbench(state: PersistedWorkbench) {
  if (typeof window !== "undefined") {
    const persisted: PersistedWorkbench = {
      ...state,
      messages: state.messages.map((message) => ({
        id: message.id,
        role: message.role,
        kind: message.kind,
        text: message.text,
        scope: message.scope,
        options: message.options,
        candidateId: message.candidateId,
        taskName: message.taskName,
        taskId: message.taskId,
        resolved: message.resolved,
        instruction: message.instruction,
        selection: message.selection,
        explicitReferences: message.explicitReferences,
      })),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  }
}

export function resetDemoWorkbench() {
  if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
}
