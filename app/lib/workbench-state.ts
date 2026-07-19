import { normalizeStoryboardBeats, type AssetSummary, type Candidate, type WorkbenchFixture } from "@/packages/shared/src";
import { createInitialFixture } from "@/packages/demo-runtime/src";

export type Selection = {
  type: "none" | "presentation_unit" | "comic_frame" | "image" | "text" | "speech_balloon" | "reference_card" | "storyboard_beat";
  id?: string;
  pageId?: string;
  label: string;
};

export type AgentMessage = {
  id: string;
  role: "user" | "agent";
  kind: "plain" | "question" | "confirmation" | "task" | "candidate" | "failed" | "canceled";
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
    text: "可以直接和我讨论漫画内容；选择画格后可以创建或编辑该格的分镜条目，也可以直接描述要创建的角色或场景图片。",
  },
];

const STORAGE_KEY = "lantern-workbench-v1";
const CURRENT_UI_VERSION = 7;
const referencePositionMigrations = new Map([
  ["reference-lincheng", { oldX: 18, newX: 270 }],
  ["reference-classroom", { oldX: 4, newX: 256 }],
]);

export function createDefaultWorkbench(): PersistedWorkbench {
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

function migrateReferencePositions(fixture: WorkbenchFixture): WorkbenchFixture {
  return {
    ...fixture,
    references: fixture.references.map((reference) => {
      const migration = referencePositionMigrations.get(reference.id);
      if (!migration || reference.x < migration.oldX - 40 || reference.x > migration.oldX + 80) return reference;
      return { ...reference, x: migration.newX + (reference.x - migration.oldX) };
    }),
  };
}

function normalizeFixture(fixture: WorkbenchFixture, fromUiVersion: number): WorkbenchFixture {
  const next = structuredClone(fixture);
  next.storyboardBeats = normalizeStoryboardBeats(next.storyboardBeats);
  return fromUiVersion < CURRENT_UI_VERSION ? migrateReferencePositions(next) : next;
}

function normalizeWorkbench(state: PersistedWorkbench): PersistedWorkbench {
  const fromUiVersion = state.uiVersion ?? 0;
  const shouldResetDemoConversation = fromUiVersion < 5;
  return {
    ...state,
    fixture: normalizeFixture(state.fixture, fromUiVersion),
    messages: shouldResetDemoConversation ? structuredClone(defaultMessages) : state.messages,
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

export function loadWorkbench(): PersistedWorkbench {
  if (typeof window === "undefined") return createDefaultWorkbench();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultWorkbench();
    const normalized = normalizeWorkbench(JSON.parse(raw) as PersistedWorkbench);
    // Demo storage is never accepted unless it contains a complete current LCD.
    return hasReadableWorkingDocument(normalized) ? normalized : createDefaultWorkbench();
  } catch {
    return createDefaultWorkbench();
  }
}

export function persistWorkbench(state: PersistedWorkbench) {
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

export function resetPersistedWorkbench() {
  if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
}
