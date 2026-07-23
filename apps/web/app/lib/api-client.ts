import type { Candidate, ReferencePlacement, WorkbenchFixture, WorkspaceChangeSet } from "@lantern/shared";
import type { ActiveTaskLike, AgentMessage, PersistedWorkbench } from "@/app/lib/workbench-state";
import { normalizeResolvedResourceUrls } from "@/app/lib/document-asset-urls";

type ApiEnvelope<T> = { data: T; requestId: string };
type ApiFailure = { error?: { code?: string; message?: string; details?: unknown } };
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_CHAPTER_ARCHIVE_BYTES = 512 * 1024 * 1024;
const SUPPORTED_UPLOAD_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/pjpeg", "image/webp"]);
const SUPPORTED_UPLOAD_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export type RuntimeIds = {
  projectId: string;
  chapterId: string;
  conversationId: string;
};

export type RuntimeAdapter = "server" | "demo";

export function configuredRuntimeAdapter(): RuntimeAdapter {
  return process.env.NEXT_PUBLIC_LANTERN_RUNTIME_ADAPTER === "demo" ? "demo" : "server";
}

export type WorkbenchLoad = {
  state: PersistedWorkbench;
  ids: RuntimeIds;
  activeTask: ActiveTaskLike | null;
  comic: { id: string; title: string; summary: string; defaultReadingDirection: "ltr" | "rtl" };
  chapter: { id: string; number: number; title: string; summary: string };
};

function apiBase() {
  return "/api/backend";
}

function uploadApiBase() {
  // Multipart uploads use the authenticated same-origin proxy as every other
  // browser request. The installation token never enters client-side code.
  return apiBase();
}

export type ComicListItem = {
  id: string;
  title: string;
  summary: string;
  worldSummary: string;
  styleSummary: string;
  format: "page" | "vertical" | "four_panel";
  defaultReadingDirection: "ltr" | "rtl";
  status: "in_progress" | "completed";
  isExample: boolean;
  coverUrl?: string;
  updatedAt: string;
  chapters: Array<{ id: string; number: number; title: string; summary: string; status: "in_progress" | "completed"; coverUrl?: string; updatedAt: string }>;
};

export type ComicAssetListItem = {
  id: string;
  kind: "character" | "scene" | "style" | "prop" | "reference_image" | "sketch" | "generated_image";
  name: string;
  description: string;
  versionId?: string;
  contentUrl?: string;
  variantCount: number;
  updatedAt: string;
};

export type ComicAssetImage = {
  id: string;
  label: string;
  sortIndex: number;
  isPrimary: boolean;
  versionId: string;
  contentUrl: string;
  width?: number;
  height?: number;
};

export type ComicAssetDetailEntry = {
  id: string;
  label: string;
  name: string;
  description: string;
  images: ComicAssetImage[];
  updatedAt: string;
};

export type ComicAssetDetail = {
  id: string;
  kind: ComicAssetListItem["kind"];
  root: ComicAssetDetailEntry;
  variants: ComicAssetDetailEntry[];
};

export type ComicVisualStyle = {
  assetId?: string;
  images: ComicAssetImage[];
};

function withAbsoluteComicUrls(comic: ComicListItem) {
  return {
    ...comic,
    coverUrl: comic.coverUrl ? absoluteAssetUrl(comic.coverUrl) : undefined,
    chapters: comic.chapters.map((chapter) => ({ ...chapter, coverUrl: chapter.coverUrl ? absoluteAssetUrl(chapter.coverUrl) : undefined })),
  };
}

export async function apiListComics(cursor?: string) {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor) query.set("cursor", cursor);
  const page = await api<{ items: ComicListItem[]; nextCursor: string | null }>(`/v1/comics?${query}`);
  return { ...page, items: page.items.map(withAbsoluteComicUrls) };
}

export async function apiGetComic(comicId: string) {
  return withAbsoluteComicUrls(await api<ComicListItem>(`/v1/comics/${encodeURIComponent(comicId)}`));
}

export async function apiListComicAssets(comicId: string) {
  const assets = await api<ComicAssetListItem[]>(`/v1/comics/${encodeURIComponent(comicId)}/assets`);
  return assets.map((asset) => ({ ...asset, contentUrl: asset.contentUrl ? absoluteAssetUrl(asset.contentUrl) : undefined }));
}

export async function apiGetAssetDetail(assetId: string) {
  return withAbsoluteAssetDetail(await api<ComicAssetDetail>(`/v1/assets/${encodeURIComponent(assetId)}`));
}

export async function apiGetComicVisualStyle(comicId: string) {
  const style = await api<ComicVisualStyle>(`/v1/comics/${encodeURIComponent(comicId)}/visual-style`);
  return { ...style, images: style.images.map((image) => ({ ...image, contentUrl: absoluteAssetUrl(image.contentUrl) })) };
}

export async function apiUploadComicVisualStyleImage(comicId: string, file: File) {
  validateUploadFile(file);
  const form = new FormData();
  form.set("file", file);
  const response = await fetch(`${uploadApiBase()}/v1/comics/${encodeURIComponent(comicId)}/visual-style/images`, { method: "POST", body: form, credentials: "include" });
  const body = await readApiResponse<ComicVisualStyle>(response, "视觉风格图片上传失败");
  if (!response.ok || !body.data) throw new Error(body.error?.message ?? "视觉风格图片上传失败");
  return { ...body.data, images: body.data.images.map((image) => ({ ...image, contentUrl: absoluteAssetUrl(image.contentUrl) })) };
}

function withAbsoluteAssetDetail(detail: ComicAssetDetail) {
  const withAbsoluteImages = (entry: ComicAssetDetailEntry) => ({
    ...entry,
    images: entry.images.map((image) => ({ ...image, contentUrl: absoluteAssetUrl(image.contentUrl) })),
  });
  return { ...detail, root: withAbsoluteImages(detail.root), variants: detail.variants.map(withAbsoluteImages) };
}

export async function apiUploadAssetImage(assetId: string, file: File) {
  validateUploadFile(file);
  const form = new FormData();
  form.set("file", file);
  const response = await fetch(`${uploadApiBase()}/v1/assets/${encodeURIComponent(assetId)}/images`, { method: "POST", body: form, credentials: "include" });
  const body = await readApiResponse<ComicAssetDetail>(response, "图片上传失败");
  if (!response.ok || !body.data) throw new Error(body.error?.message ?? "图片上传失败");
  return withAbsoluteAssetDetail(body.data);
}

export async function apiSetPrimaryAssetImage(assetId: string, imageId: string) {
  return withAbsoluteAssetDetail(await api<ComicAssetDetail>(`/v1/assets/${encodeURIComponent(assetId)}/images/${encodeURIComponent(imageId)}/primary`, { method: "POST", body: "{}" }));
}

export async function apiRenameAssetImage(assetId: string, imageId: string, label: string) {
  return withAbsoluteAssetDetail(await api<ComicAssetDetail>(`/v1/assets/${encodeURIComponent(assetId)}/images/${encodeURIComponent(imageId)}`, { method: "PATCH", body: JSON.stringify({ label }) }));
}

export async function apiDeleteAssetImage(assetId: string, imageId: string) {
  return withAbsoluteAssetDetail(await api<ComicAssetDetail>(`/v1/assets/${encodeURIComponent(assetId)}/images/${encodeURIComponent(imageId)}`, { method: "DELETE", body: "{}" }));
}

export function apiDeleteAsset(assetId: string) {
  return api<{ id: string; deleted: boolean; archivedAssetIds: string[] }>(`/v1/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
}

export function apiCreateComic(input: { title: string; summary?: string; worldSummary?: string; styleSummary?: string; format?: "page" | "vertical" | "four_panel"; defaultReadingDirection?: "ltr" | "rtl" }) {
  return api<{ comic: { id: string; title: string } }>("/v1/comics", { method: "POST", body: JSON.stringify(input) });
}

export function apiUpdateComic(comicId: string, input: { title?: string; summary?: string; worldSummary?: string; styleSummary?: string; defaultReadingDirection?: "ltr" | "rtl"; status?: "in_progress" | "completed" }) {
  return api<{ id: string; title: string; summary: string; worldSummary: string; styleSummary: string; defaultReadingDirection: "LTR" | "RTL"; status: "IN_PROGRESS" | "COMPLETED" }>(`/v1/comics/${encodeURIComponent(comicId)}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function apiDeleteComic(comicId: string) {
  return api<{ id: string; deleted: boolean }>(`/v1/comics/${encodeURIComponent(comicId)}`, { method: "DELETE" });
}

export function apiDuplicateComic(comicId: string) {
  // Keep a JSON body here: Fastify rejects an empty request body when the
  // client declares application/json.
  return api<{ comicId: string; firstChapterId?: string }>(`/v1/comics/${encodeURIComponent(comicId)}/duplicate`, { method: "POST", body: "{}" });
}

export function apiCreateChapter(comicId: string, input: { title: string; summary?: string }) {
  return api<{ comicId: string; chapterId: string; number: number; title: string }>(`/v1/comics/${encodeURIComponent(comicId)}/chapters`, { method: "POST", body: JSON.stringify(input) });
}

export function apiUpdateChapter(comicId: string, chapterId: string, input: { title?: string; summary?: string; status?: "in_progress" | "completed" }) {
  return api<{ id: string; title: string; summary: string; status: "IN_PROGRESS" | "COMPLETED" }>(`/v1/comics/${encodeURIComponent(comicId)}/chapters/${encodeURIComponent(chapterId)}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function apiDeleteChapter(comicId: string, chapterId: string) {
  return api<{ id: string; deleted: boolean }>(`/v1/comics/${encodeURIComponent(comicId)}/chapters/${encodeURIComponent(chapterId)}`, { method: "DELETE" });
}

async function uploadCover(path: string, file: File) {
  validateUploadFile(file);
  const form = new FormData();
  form.set("file", file);
  const response = await fetch(`${uploadApiBase()}${path}`, {
    method: "POST",
    body: form,
    credentials: "include",
  });
  const body = await readApiResponse<{ coverUrl: string }>(response, "上传封面失败");
  if (!response.ok) throw new Error(body.error?.message ?? "上传封面失败");
  return { ...body.data, coverUrl: absoluteAssetUrl(body.data.coverUrl) };
}

function validateUploadFile(file: File) {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("图片文件太大，请上传 50MB 以内的 PNG、JPEG 或 WebP。");
  const extension = file.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  const supportedExtension = extension ? SUPPORTED_UPLOAD_EXTENSIONS.has(extension) : false;
  if (file.type && !SUPPORTED_UPLOAD_TYPES.has(file.type.toLowerCase()) && !supportedExtension) throw new Error("请选择 PNG、JPEG/JPG 或 WebP 图片。");
  if (!file.type && !supportedExtension) throw new Error("请选择 PNG、JPEG/JPG 或 WebP 图片。");
}

export function apiUploadComicCover(comicId: string, file: File) {
  return uploadCover(`/v1/comics/${encodeURIComponent(comicId)}/cover`, file);
}

export function apiUploadChapterCover(comicId: string, chapterId: string, file: File) {
  return uploadCover(`/v1/comics/${encodeURIComponent(comicId)}/chapters/${encodeURIComponent(chapterId)}/cover`, file);
}

export function apiUrl(path: string) {
  return path.startsWith("/v1/") ? `${apiBase()}${path}` : path;
}

function absoluteAssetUrl(value: string) {
  return value.startsWith("/v1/") ? `${apiBase()}${value}` : value;
}

async function api<T>(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  const body = await readApiResponse<T>(response, `Lantern API ${response.status}`);
  if (!response.ok) throw new LanternApiError(body.error?.message ?? `Lantern API ${response.status}`, body.error?.code, body.error?.details);
  return body.data;
}

export class LanternApiError extends Error {
  constructor(message: string, public readonly code?: string, public readonly details?: unknown) {
    super(message);
    this.name = "LanternApiError";
  }
}

export type ModelCapability = "text" | "image" | "vision";

export type GlobalSettings = {
  models: Array<{
    capability: ModelCapability;
    label: string;
    description: string;
    providerId: string;
    baseUrl: string;
    model: string;
    keyConfigured: boolean;
    usesFallbackKey: boolean;
    environmentOverride: boolean;
    providerOptions: Array<{
      id: string;
      label: string;
      description: string;
      defaultBaseUrl: string;
      defaultModel: string;
    }>;
  }>;
  runtime: {
    dataDirectory: string;
    apiPort: number;
    webPort: number;
    objectStorage: string;
  };
};

export function apiGetGlobalSettings() {
  return api<GlobalSettings>("/v1/settings");
}

export function apiUpdateGlobalSettings(models: Array<{
  capability: ModelCapability;
  providerId: string;
  baseUrl: string;
  model: string;
  apiKey?: string | null;
}>) {
  return api<GlobalSettings>("/v1/settings", { method: "PATCH", body: JSON.stringify({ models }) });
}

async function readApiResponse<T>(response: Response, fallbackMessage: string) {
  const text = await response.text();
  if (!text) return {} as ApiEnvelope<T> & ApiFailure;
  try {
    return JSON.parse(text) as ApiEnvelope<T> & ApiFailure;
  } catch {
    const message = response.status === 413 || /payload too large/i.test(text)
      ? "上传通道暂时拒绝了这张图片，请稍后重试；不需要更换图片。"
      : text.slice(0, 200) || fallbackMessage;
    return { error: { message } } as ApiEnvelope<T> & ApiFailure;
  }
}

type WorkbenchResponse = {
  comic: { id: string; title: string; summary: string; defaultReadingDirection: "LTR" | "RTL" };
  project: { id: string };
  conversations: Array<{ id: string; title: string; createdAt: string; updatedAt: string }>;
  chapter: { id: string; number: number; title: string; summary: string };
  working: WorkbenchFixture["working"];
  snapshot?: WorkbenchFixture["snapshot"];
  storyboardBeats: WorkbenchFixture["storyboardBeats"];
  references: Array<ReferencePlacement & { assetId?: string; assetVersionId?: string; libraryStatus?: "canvas_only" | "library" }>;
  assets: Array<{
    id: string;
    kind: "character" | "scene" | "style" | "prop" | "reference_image" | "sketch" | "generated_image";
    name: string;
    description: string;
    currentVersion?: { id: string; contentUrl?: string };
    versions?: Array<{ id: string; version: number; contentUrl?: string; width?: number; height?: number; createdAt?: string }>;
    images?: Array<{ id: string; versionId: string; label: string; contentUrl?: string; isPrimary: boolean }>;
    canvasListItemId?: string;
    libraryStatus?: "canvas_only" | "library";
    pinned?: boolean;
    sortIndex?: number;
  }>;
  conversation?: { id: string };
  messages: Array<{
    id: string;
    role: "user" | "agent";
    kind: AgentMessage["kind"];
    text: string;
    metadata?: Record<string, unknown>;
    attachments?: Array<{ id: string; name: string; imageUrl: string }>;
  }>;
  candidates: Array<Candidate & { payload?: unknown; operations?: unknown[] }>;
  tasks: Array<{
    id: string;
    type: string;
    status: string;
    progress: number;
    errorMessage?: string;
    target?: { canvasX?: number; canvasY?: number; label?: string };
    createdAt: string;
  }>;
};

/** One ingress mapper for every LCD document received by the browser. */
export function normalizeResolvedResources(resources: WorkbenchFixture["working"]["resolvedResources"]) {
  return normalizeResolvedResourceUrls(resources, apiBase());
}

function mapWorkbench(data: WorkbenchResponse): WorkbenchLoad {
  const candidates = data.candidates.map((candidate) => {
    const runtimeCandidate = candidate as Candidate & {
      taskId?: string;
      target?: { canvasX?: number; canvasY?: number };
      previewUrl?: string;
      outputRefs?: Array<{ objectType?: string; objectId?: string; versionId?: string }>;
      commands?: Candidate["commands"];
      payload?: { kind?: string; name?: string; description?: string; mode?: "create" | "replace"; title?: string; storyboardBeatId?: string };
    };
    const outputAsset = runtimeCandidate.outputRefs?.find((ref) => ref.objectType === "asset");
    return {
      id: candidate.id,
      kind: candidate.kind,
      title: candidate.title,
      changeSummary: candidate.changeSummary,
      targetLabel: candidate.targetLabel,
      baseRevision: candidate.baseRevision,
      status: candidate.status,
      ...(runtimeCandidate.commands ? { commands: runtimeCandidate.commands as Candidate["commands"] } : {}),
      metadata: {
        runtime: "persistent",
        ...(runtimeCandidate.taskId ? { taskId: runtimeCandidate.taskId } : {}),
        ...(runtimeCandidate.previewUrl ? { previewUrl: absoluteAssetUrl(runtimeCandidate.previewUrl) } : {}),
        ...(outputAsset?.objectId ? { outputAssetId: outputAsset.objectId } : {}),
        ...(outputAsset?.versionId ? { outputAssetVersionId: outputAsset.versionId } : {}),
        ...(runtimeCandidate.payload?.kind ? { assetKind: runtimeCandidate.payload.kind } : {}),
        ...(runtimeCandidate.payload?.name ? { assetName: runtimeCandidate.payload.name } : {}),
        ...(runtimeCandidate.payload?.description ? { assetDescription: runtimeCandidate.payload.description } : {}),
        ...(runtimeCandidate.payload?.mode ? { storyboardMode: runtimeCandidate.payload.mode } : {}),
        ...(runtimeCandidate.payload?.title ? { storyboardTitle: runtimeCandidate.payload.title } : {}),
        ...(runtimeCandidate.payload?.mode && runtimeCandidate.payload?.description ? { storyboardDescription: runtimeCandidate.payload.description } : {}),
        ...(runtimeCandidate.payload?.storyboardBeatId ? { storyboardBeatId: runtimeCandidate.payload.storyboardBeatId } : {}),
        ...(typeof runtimeCandidate.target?.canvasX === "number" ? { canvasX: String(runtimeCandidate.target.canvasX) } : {}),
        ...(typeof runtimeCandidate.target?.canvasY === "number" ? { canvasY: String(runtimeCandidate.target.canvasY) } : {}),
      },
    };
  }) as Candidate[];
  const messages = data.messages.map((message) => {
    const metadata = message.metadata ?? {};
    const decision = metadata.kind ? metadata : undefined;
    const questions = Array.isArray(metadata.questions) ? metadata.questions as Array<{ options?: Array<{ label?: string }> }> : [];
    return {
      id: message.id,
      role: message.role,
      kind: message.kind,
      text: message.text,
      candidateId: typeof metadata.candidateId === "string" ? metadata.candidateId : undefined,
      taskName: typeof metadata.taskType === "string" ? metadata.taskType : decision && typeof decision.taskType === "string" ? decision.taskType : undefined,
      taskId: typeof metadata.taskId === "string" ? metadata.taskId : undefined,
      resolved: metadata.resolved === true,
      scope: typeof metadata.scope === "string" ? metadata.scope : undefined,
      options: questions.flatMap((question) => question.options?.map((option) => option.label).filter((item): item is string => Boolean(item)) ?? []),
      instruction: typeof metadata.instruction === "string" ? metadata.instruction : undefined,
      selection: metadata.selection && typeof metadata.selection === "object" ? metadata.selection as AgentMessage["selection"] : undefined,
      explicitReferences: Array.isArray(metadata.explicitReferences) ? metadata.explicitReferences as NonNullable<AgentMessage["explicitReferences"]> : undefined,
      attachments: message.attachments?.map((attachment) => ({ ...attachment, imageUrl: absoluteAssetUrl(attachment.imageUrl) })),
    } satisfies AgentMessage;
  });
  const running = data.tasks.find((task) => task.status === "running" || task.status === "queued" || task.status === "created");
  const failed = !running && data.tasks[0]?.status === "failed" ? data.tasks[0] : undefined;
  const activeTask = running ? {
    id: running.id,
    name: running.type,
    label: running.type === "asset_image_generate" ? "创建角色或场景" : running.type === "frame_image_generate" ? "生成单格画面" : "编辑分镜条目",
    scope: running.target?.label ?? "当前创作范围",
    progress: running.progress,
    status: "running" as const,
    stage: (running.status === "created" ? "preparing" : running.status === "queued" ? "queued" : running.progress >= 88 ? "saving" : running.progress >= 72 ? "validating" : "generating") as NonNullable<ActiveTaskLike["stage"]>,
    targetLabel: running.target?.label,
    createdAt: running.createdAt,
    elapsedSeconds: Math.max(0, Math.floor((Date.now() - new Date(running.createdAt).getTime()) / 1000)),
  } : failed ? {
    id: failed.id,
    name: failed.type,
    label: "任务失败",
    scope: failed.errorMessage ?? "工作稿未改变",
    progress: failed.progress,
    status: "failed" as const,
  } : null;
  return {
    state: {
      fixture: {
        working: { ...data.working, resolvedResources: normalizeResolvedResources(data.working.resolvedResources) },
        snapshot: data.snapshot ? { ...data.snapshot, resolvedResources: normalizeResolvedResources(data.snapshot.resolvedResources) } : undefined,
        storyboardBeats: data.storyboardBeats,
        references: data.references.map((reference) => ({ ...reference, imageSrc: absoluteAssetUrl(reference.imageSrc), images: reference.images?.map((image) => ({ ...image, imageSrc: absoluteAssetUrl(image.imageSrc) })) })),
      },
      candidates,
      messages,
      currentPageIndex: 0,
      assets: data.assets.map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        name: asset.name,
        description: asset.description,
        versionId: asset.currentVersion?.id,
        contentUrl: asset.currentVersion?.contentUrl ? absoluteAssetUrl(asset.currentVersion.contentUrl) : undefined,
        canvasListItemId: asset.canvasListItemId,
        libraryStatus: asset.libraryStatus,
        pinned: asset.pinned,
        sortIndex: asset.sortIndex,
        versions: asset.versions?.map((version) => ({ ...version, contentUrl: version.contentUrl ? absoluteAssetUrl(version.contentUrl) : undefined })),
        images: asset.images?.map((image) => ({ ...image, contentUrl: image.contentUrl ? absoluteAssetUrl(image.contentUrl) : undefined })),
      })),
      conversations: data.conversations,
      uiVersion: 6,
    },
    ids: {
      projectId: data.project.id,
      chapterId: data.chapter.id,
      conversationId: data.conversation?.id ?? "",
    },
    activeTask,
    comic: { ...data.comic, defaultReadingDirection: data.comic.defaultReadingDirection.toLowerCase() as "ltr" | "rtl" },
    chapter: data.chapter,
  };
}

export async function apiLoadWorkbench(chapterId: string, conversationId?: string) {
  const query = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : "";
  return mapWorkbench(await api<WorkbenchResponse>(`/v1/workbench/${encodeURIComponent(chapterId)}${query}`));
}

export function apiCreateConversation(projectId: string, title?: string) {
  return api<{ id: string; title: string }>(`/v1/projects/${encodeURIComponent(projectId)}/conversations`, { method: "POST", body: JSON.stringify({ title }) });
}

export function apiGetContextDebugSnapshot(projectId: string, body: {
  conversationId: string;
  message: string;
  intent?: string;
  scope?: string;
  currentPageId?: string;
  visiblePageIds?: string[];
  selection?: { type: string; id?: string; pageId?: string; label?: string };
  explicitReferences?: Array<{ objectType: string; objectId: string; versionId?: string; label?: string }>;
  currentPageIndex?: number;
  workspaceMode?: string;
  pendingAttachments?: Array<{ name: string }>;
}) {
  return api<Record<string, unknown>>(`/v1/projects/${encodeURIComponent(projectId)}/context-debug`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function apiUpdateConversation(conversationId: string, patch: { title?: string; archived?: boolean }) {
  return api<{ id: string; title: string }>(`/v1/conversations/${encodeURIComponent(conversationId)}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function apiUpdateAsset(assetId: string, patch: { name?: string; description?: string }) {
  return api<{ id: string; name: string; description: string; updatedAt: string }>(`/v1/assets/${encodeURIComponent(assetId)}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function apiUpdateCanvasAssetListItem(itemId: string, patch: { displayName?: string; pinned?: boolean; hidden?: boolean; sortIndex?: number }) {
  return api<{ id: string; displayName: string; pinned: boolean; hiddenAt?: string | null }>(`/v1/canvas-asset-items/${encodeURIComponent(itemId)}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function apiSaveCanvasAssetToLibrary(itemId: string, input?: { name?: string; description?: string; kind?: "character" | "scene" | "prop" | "reference_image" }) {
  return api<{ itemId: string; assetId: string; libraryStatus: "library"; kind: "character" | "scene" | "prop" | "reference_image" }>(`/v1/canvas-asset-items/${encodeURIComponent(itemId)}/save-to-library`, { method: "POST", body: JSON.stringify(input ?? {}) });
}


export async function apiCommitChangeSet(projectId: string, changeSet: WorkspaceChangeSet) {
  const result = await api<Pick<WorkbenchFixture, "working" | "storyboardBeats">>(`/v1/projects/${encodeURIComponent(projectId)}/changesets`, {
    method: "POST",
    body: JSON.stringify({ expectedWorkingRevision: changeSet.baseRevision, changeSet }),
  });
  // A direct ChangeSet response bypasses apiLoadWorkbench/mapWorkbench, so
  // normalize the separate v0.4 resource read model here as well.
  return {
    ...result,
    working: {
      ...result.working,
      resolvedResources: normalizeResolvedResources(result.working.resolvedResources),
    },
  };
}

type AgentInteractionRequest = {
  message: string;
  intent?: string;
  scope?: string;
  currentPageId?: string;
  visiblePageIds?: string[];
  selection: { type: string; id?: string; pageId?: string; label?: string };
  explicitReferences?: Array<{ objectType: string; objectId: string; versionId?: string; label?: string }>;
  imageAttachments?: Array<{ assetId: string; versionId: string; name: string }>;
};

type AgentInteractionResult = { decision:
    | { kind: "direct_answer"; message: string }
    | { kind: "needs_input"; message: string; questions: Array<{ options?: Array<{ label: string }> }> }
    | { kind: "ready_to_run"; capabilityId: string; message: string; scope: string; taskType: string };
    task?: { id: string; type: string; status: string; scope: string; progress: number; createdAt: string };
  };

export async function apiSendInteraction(ids: RuntimeIds, body: AgentInteractionRequest) {
  return api<AgentInteractionResult>(`/v1/conversations/${encodeURIComponent(ids.conversationId)}/interactions`, {
    method: "POST",
    body: JSON.stringify({ ...body, idempotencyKey: `web:${crypto.randomUUID()}` }),
  });
}

export async function apiStreamInteraction(ids: RuntimeIds, body: AgentInteractionRequest, handlers: {
  onDecision?: (decision: Omit<AgentInteractionResult["decision"], "message">) => void;
  onTextDelta?: (delta: string) => void;
}) {
  const response = await fetch(`${apiBase()}/v1/conversations/${encodeURIComponent(ids.conversationId)}/interactions/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, idempotencyKey: `web:${crypto.randomUUID()}` }),
    credentials: "include",
  });
  if (!response.ok || !response.body) {
    const failure = await readApiResponse<never>(response, `Lantern API ${response.status}`);
    throw new LanternApiError(failure.error?.message ?? `Lantern API ${response.status}`, failure.error?.code, failure.error?.details);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: AgentInteractionResult | undefined;
  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as
      | { type: "decision"; decision: Omit<AgentInteractionResult["decision"], "message"> }
      | { type: "text_delta"; delta: string }
      | ({ type: "complete" } & AgentInteractionResult);
    if (event.type === "decision") handlers.onDecision?.(event.decision);
    else if (event.type === "text_delta") handlers.onTextDelta?.(event.delta);
    else completed = { decision: event.decision, task: event.task };
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(consumeLine);
    if (done) break;
  }
  if (buffer) consumeLine(buffer);
  if (!completed) throw new Error("Agent 流式响应未正常结束。");
  return completed;
}

export function apiResolveAgentMessage(messageId: string) {
  return api<{ id: string; resolved: true }>(`/v1/agent-messages/${encodeURIComponent(messageId)}/resolve`, { method: "POST", body: "{}" });
}

export function apiRetryAgentInteraction(messageId: string) {
  return api<AgentInteractionResult>(`/v1/agent-messages/${encodeURIComponent(messageId)}/retry`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: `web-interaction-retry:${crypto.randomUUID()}` }),
  });
}

export function apiRetryTask(taskId: string) {
  return api(`/v1/tasks/${encodeURIComponent(taskId)}/retry`, { method: "POST", body: JSON.stringify({ idempotencyKey: `web-retry:${crypto.randomUUID()}` }) });
}

export async function apiCreateTask(ids: RuntimeIds, body: {
  taskType: "storyboard" | "frame_image_generate" | "asset_image_generate";
  instruction: string;
  scope: string;
  selection: { type: string; id?: string; pageId?: string; label?: string; canvasX?: number; canvasY?: number };
  explicitReferences?: Array<{ objectType: string; objectId: string; versionId?: string; label?: string }>;
}) {
  return api("/v1/tasks", {
    method: "POST",
    body: JSON.stringify({
      ...body,
      projectId: ids.projectId,
      conversationId: ids.conversationId,
      idempotencyKey: `web:${crypto.randomUUID()}`,
    }),
  });
}

export function apiApplyCandidate(candidateId: string, expectedWorkingRevision: number, expectedFrameTarget?: { unitId: string; frameId: string }) {
  return api<{ asset?: { id: string; name: string; description: string; kind: string }; revision?: number }>(`/v1/candidates/${encodeURIComponent(candidateId)}/apply`, {
    method: "POST",
    body: JSON.stringify({ expectedWorkingRevision, expectedFrameTarget }),
  });
}

export function apiDiscardCandidate(candidateId: string) {
  return api(`/v1/candidates/${encodeURIComponent(candidateId)}/discard`, { method: "POST", body: "{}" });
}

export function apiSaveSnapshot(chapterId: string, expectedWorkingRevision: number) {
  return api(`/v1/chapters/${encodeURIComponent(chapterId)}/save-snapshot`, {
    method: "POST",
    body: JSON.stringify({ expectedWorkingRevision }),
  });
}

export function apiRestoreSnapshot(chapterId: string, expectedWorkingRevision: number) {
  return api<Pick<WorkbenchFixture, "working" | "storyboardBeats">>(`/v1/chapters/${encodeURIComponent(chapterId)}/restore-snapshot`, {
    method: "POST",
    body: JSON.stringify({ expectedWorkingRevision }),
  }).then((result) => ({
    ...result,
    working: { ...result.working, resolvedResources: normalizeResolvedResources(result.working.resolvedResources) },
  }));
}

async function downloadPageResponse(path: string, fallbackName: string) {
  const response = await fetch(apiUrl(path));
  if (!response.ok) throw new Error("下载失败，请稍后重试。");
  const blob = await response.blob();
  const fileName = response.headers.get("Content-Disposition")?.match(/filename="?([^";]+)"?/)?.[1] ?? fallbackName;
  saveBrowserBlob(blob, fileName);
}

function saveBrowserBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function responseFileName(response: Response, fallbackName: string) {
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded); } catch { return fallbackName; }
  }
  return disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? fallbackName;
}

function imageFileName(name: string, contentType: string) {
  const baseName = name
    .trim()
    .replace(/\.(?:png|jpe?g|webp|gif)$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 160) || "asset-image";
  const normalizedContentType = contentType.split(";", 1)[0]?.toLowerCase() ?? "";
  const extension = ({ "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" } as Record<string, string>)[normalizedContentType] ?? ".png";
  return baseName.toLowerCase().endsWith(extension) ? baseName : `${baseName}${extension}`;
}

export async function apiDownloadImage(contentUrl: string, name: string) {
  const response = await fetch(contentUrl, { credentials: "include" });
  if (!response.ok) throw new Error("图片下载失败，请稍后重试。");
  const blob = await response.blob();
  saveBrowserBlob(blob, imageFileName(name, blob.type));
}

export async function apiDownloadAssetImage(image: ComicAssetImage, assetName: string) {
  return apiDownloadImage(image.contentUrl, `${assetName}-${image.label}`);
}

export async function apiDownloadPage(chapterId: string, unitId: string) {
  if (!unitId) throw new Error("当前没有可下载的漫画页。");
  return downloadPageResponse(`/v1/chapters/${encodeURIComponent(chapterId)}/pages/${encodeURIComponent(unitId)}/download`, `${unitId}.png`);
}

export async function apiDownloadSurface(chapterId: string, unitId: string, surfaceId: string) {
  if (!unitId || !surfaceId) throw new Error("当前没有可下载的物理纸面。");
  return downloadPageResponse(`/v1/chapters/${encodeURIComponent(chapterId)}/pages/${encodeURIComponent(unitId)}/surfaces/${encodeURIComponent(surfaceId)}/download`, `${surfaceId}.png`);
}

export async function apiDownloadPreviewSpread(chapterId: string, firstUnitId: string, secondUnitId: string) {
  if (!firstUnitId || !secondUnitId) throw new Error("当前没有可下载的双页预览。");
  return downloadPageResponse(`/v1/chapters/${encodeURIComponent(chapterId)}/preview-spreads/${encodeURIComponent(firstUnitId)}/${encodeURIComponent(secondUnitId)}/download`, `${firstUnitId}-${secondUnitId}.png`);
}

export async function apiDownloadChapterArchive(chapterId: string) {
  const response = await fetch(apiUrl(`/v1/chapters/${encodeURIComponent(chapterId)}/archive/download`), { credentials: "include" });
  if (!response.ok) {
    const body = await readApiResponse<never>(response, "完整 LCD 资源下载失败");
    throw new Error(body.error?.message ?? "完整 LCD 资源下载失败，请稍后重试。");
  }
  saveBrowserBlob(await response.blob(), responseFileName(response, `${chapterId}-saved.lantern.zip`));
}

export async function apiImportChapterArchive(chapterId: string, expectedWorkingRevision: number, file: File) {
  if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("请选择 Lantern 导出的 ZIP 完整 LCD 归档。");
  if (!file.size || file.size > MAX_CHAPTER_ARCHIVE_BYTES) throw new Error("完整 LCD 归档必须小于 512MB。");
  const form = new FormData();
  form.set("file", file);
  const response = await fetch(`${uploadApiBase()}/v1/chapters/${encodeURIComponent(chapterId)}/archive/import?expectedWorkingRevision=${expectedWorkingRevision}`, {
    method: "POST",
    body: form,
    credentials: "include",
  });
  const body = await readApiResponse<{ revision: number; importedResources: number; importedStoryboardBeats: number }>(response, "完整 LCD 导入失败");
  if (!response.ok || !body.data) throw new Error(body.error?.message ?? "完整 LCD 导入失败，请稍后重试。");
  return body.data;
}

export function apiCancelTask(taskId: string) {
  return api(`/v1/tasks/${encodeURIComponent(taskId)}/cancel`, { method: "POST", body: "{}" });
}

export function apiGetTask(taskId: string) {
  return api<{
    id: string;
    status: string;
    progress: number;
    errorMessage?: string;
    output?: { artifacts?: Array<{ fileName: string; downloadUrl: string }> };
  }>(`/v1/tasks/${encodeURIComponent(taskId)}`);
}

export async function apiUploadAsset(projectId: string, file: File, kind = "reference_image", placement?: { x: number; y: number }) {
  validateUploadFile(file);
  const form = new FormData();
  form.set("file", file);
  form.set("kind", kind);
  form.set("name", file.name.replace(/\.[^.]+$/, ""));
  if (placement) {
    form.set("x", String(placement.x));
    form.set("y", String(placement.y));
  }
  const response = await fetch(`${uploadApiBase()}/v1/projects/${encodeURIComponent(projectId)}/assets${placement ? "?place=canvas" : ""}`, {
    method: "POST",
    body: form,
    credentials: "include",
  });
  const body = await readApiResponse<{ id: string; name: string; versions: Array<{ id: string; contentType?: string; width?: number; height?: number }> }>(response, "上传失败");
  if (!response.ok) throw new Error(body.error?.message ?? "上传失败");
  if (!body.data) throw new Error("上传失败");
  return body.data;
}

export async function apiUploadAgentAttachment(projectId: string, file: File) {
  validateUploadFile(file);
  const form = new FormData();
  form.set("file", file);
  form.set("kind", "reference_image");
  form.set("name", file.name.replace(/\.[^.]+$/, ""));
  const response = await fetch(`${uploadApiBase()}/v1/projects/${encodeURIComponent(projectId)}/assets?usage=conversation`, {
    method: "POST",
    body: form,
    credentials: "include",
  });
  const body = await readApiResponse<{ id: string; versions: Array<{ id: string }> }>(response, "图片附件上传失败");
  if (!response.ok || !body.data?.versions[0]) throw new Error(body.error?.message ?? "图片附件上传失败");
  return { assetId: body.data.id, versionId: body.data.versions[0].id, name: file.name };
}

export function apiUpdatePlacement(placementId: string, patch: { x?: number; y?: number; zoom?: number; zIndex?: number; collapsed?: boolean; pinned?: boolean; assetVersionId?: string }) {
  return api(`/v1/placements/${encodeURIComponent(placementId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function apiDeletePlacement(placementId: string) {
  return api(`/v1/placements/${encodeURIComponent(placementId)}`, { method: "DELETE", body: "{}" });
}

export function apiPlaceAsset(projectId: string, assetId: string, x: number, y: number) {
  return api(`/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/place`, {
    method: "POST",
    body: JSON.stringify({ x, y }),
  });
}

export function apiImportAssetToCanvasList(projectId: string, assetId: string) {
  return api<{ id: string }>(`/v1/projects/${encodeURIComponent(projectId)}/canvas-assets/${encodeURIComponent(assetId)}/import`, { method: "POST", body: "{}" });
}
