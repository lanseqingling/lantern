"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@lantern/ui";
import { AssetCreateDialog } from "@/app/components/AssetCreateDialog";
import { AssetDetailDialog } from "@/app/components/AssetDetailDialog";
import { ComicBriefDialog } from "@/app/components/ComicBriefDialog";
import { assetKindLabel, assetKindTag } from "@/app/lib/asset-kind";
import { navigateWithContentTransition, useContentRouteEntryTransition } from "@/app/lib/content-route-transition";
import { apiCreateComicAsset, apiDeleteAsset, apiDeleteAssetImage, apiGetAssetDetail, apiGetComic, apiGetComicVisualStyle, apiImportAssetToCanvasList, apiListComicAssets, apiLoadWorkbench, apiRenameAssetImage, apiSetPrimaryAssetImage, apiUpdateAsset, apiUpdateComic, apiUploadAssetImage, apiUploadComicVisualStyleImage, type ComicAssetDetail, type ComicAssetListItem, type ComicListItem, type ComicVisualStyle } from "@/app/lib/api-client";

type AssetFilter = "all" | "character" | "scene" | "prop" | "reference";
type BriefId = "story" | "world" | "style";
type AssetCreateKind = "character" | "scene" | "prop" | "reference_image";

const filters: Array<{ id: AssetFilter; label: string; kinds?: ComicAssetListItem["kind"][] }> = [
  { id: "all", label: "全部" },
  { id: "character", label: "角色", kinds: ["character"] },
  { id: "scene", label: "场景", kinds: ["scene"] },
  { id: "prop", label: "道具", kinds: ["prop"] },
  // Image assets only arrive here through an explicit user upload/add.
  // Page-owned generated frame images are intentionally absent.
  { id: "reference", label: "图片", kinds: ["reference_image"] },
];

const filterIcons = { all: "assetAll", character: "user", scene: "scene", prop: "prop", reference: "referenceImage" } as const;

/** Comic-level reusable assets. A chapter only stores its own canvas placements. */
export default function ComicAssetsPage() {
  const router = useRouter();
  const entryTransition = useContentRouteEntryTransition();
  const params = useParams<{ comicId: string }>();
  const query = useSearchParams();
  const comicId = params.comicId;
  const chapterId = query.get("chapterId");
  const returnToWorkbench = query.get("from") === "workbench" && chapterId;
  const requestedFilter = query.get("filter");
  const initialFilter: AssetFilter = filters.some((item) => item.id === requestedFilter) ? requestedFilter as AssetFilter : "all";
  const [filterState, setFilterState] = useState<{ query: string | null; value: AssetFilter }>({ query: requestedFilter, value: initialFilter });
  const filter = filterState.query === requestedFilter ? filterState.value : initialFilter;
  const [assets, setAssets] = useState<ComicAssetListItem[]>([]);
  const [comic, setComic] = useState<ComicListItem | null>(null);
  const [visualStyle, setVisualStyle] = useState<ComicVisualStyle>({ images: [] });
  const [editingBrief, setEditingBrief] = useState<BriefId | null>(null);
  const [briefReturnFocus, setBriefReturnFocus] = useState<HTMLButtonElement | null>(null);
  const selectedId = query.get("asset");
  const [detailResult, setDetailResult] = useState<{ assetId: string; requestKey: number; detail: ComicAssetDetail | null; error: string } | null>(null);
  const [detailRequestKey, setDetailRequestKey] = useState(0);
  const [detailReturnFocus, setDetailReturnFocus] = useState<HTMLButtonElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  const [creatingAsset, setCreatingAsset] = useState(false);
  const [createAssetReturnFocus, setCreateAssetReturnFocus] = useState<HTMLButtonElement | null>(null);

  useEffect(() => {
    let canceled = false;
    void Promise.all([apiGetComic(comicId), apiListComicAssets(comicId), apiGetComicVisualStyle(comicId)])
      .then(([nextComic, items, nextVisualStyle]) => { if (!canceled) { setComic(nextComic); setAssets(items); setVisualStyle(nextVisualStyle); setError(""); } })
      .catch((reason) => { if (!canceled) setError(reason instanceof Error ? reason.message : "资产暂时无法读取。"); })
      .finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, [comicId]);
  const visibleAssets = useMemo(() => {
    const active = filters.find((item) => item.id === filter);
    return active?.kinds ? assets.filter((asset) => active.kinds?.includes(asset.kind)) : assets;
  }, [assets, filter]);

  useEffect(() => {
    if (!selectedId) return;
    let canceled = false;
    void apiGetAssetDetail(selectedId)
      .then((result) => { if (!canceled) setDetailResult({ assetId: selectedId, requestKey: detailRequestKey, detail: result, error: "" }); })
      .catch((reason) => { if (!canceled) setDetailResult({ assetId: selectedId, requestKey: detailRequestKey, detail: null, error: reason instanceof Error ? reason.message : "资产详情暂时无法读取。" }); });
    return () => { canceled = true; };
  }, [selectedId, detailRequestKey]);
  const currentDetailResult = detailResult?.assetId === selectedId && detailResult.requestKey === detailRequestKey ? detailResult : null;
  const detailLoading = Boolean(selectedId && !currentDetailResult);

  const navigate = (href: string, direction: "forward" | "back" = "forward") => navigateWithContentTransition(direction, () => router.push(href));
  const goBack = () => navigate(returnToWorkbench ? `/comics/${comicId}/chapters/${chapterId}` : `/comics/${comicId}`, "back");
  const addLabel = ({ all: "添加资产", character: "添加角色", scene: "添加场景", prop: "添加道具", reference: "添加图片" } as const)[filter];
  const initialCreateKind: AssetCreateKind = "character";
  const openAssetCreate = (trigger: HTMLButtonElement) => {
    setCreateAssetReturnFocus(trigger);
    setCreatingAsset(true);
  };

  const closeAssetCreate = () => {
    setCreatingAsset(false);
    window.requestAnimationFrame(() => createAssetReturnFocus?.focus());
  };

  const createAsset = async (input: { kind: AssetCreateKind; name: string; description: string; image?: File }) => {
    let detail = await apiCreateComicAsset(comicId, input);
    if (input.image) detail = await apiUploadAssetImage(detail.root.id, input.image);
    const cover = detail.root.images[0];
    setAssets((current) => [{
      id: detail.root.id,
      kind: detail.kind,
      name: detail.root.name,
      description: detail.root.description,
      versionId: cover?.versionId,
      contentUrl: cover?.contentUrl,
      variantCount: detail.variants.length,
      updatedAt: detail.root.updatedAt,
    }, ...current]);
    closeAssetCreate();
    setNotice(`已创建资产“${detail.root.name}”`);
  };

  const continueAssetWithAI = async (input: { kind: AssetCreateKind; name: string; description: string }) => {
    const targetChapterId = chapterId ?? comic?.chapters.at(-1)?.id;
    if (!targetChapterId) throw new Error("请先新建一话，再交给 AI 创建资产。");
    const query = new URLSearchParams({
      assetCreate: input.kind === "reference_image" ? "reference" : input.kind,
      assetDraft: JSON.stringify(input),
    });
    navigate(`/comics/${comicId}/chapters/${targetChapterId}?${query.toString()}`);
  };

  const openAssetDetail = (assetId: string, trigger: HTMLButtonElement) => {
    setDetailReturnFocus(trigger);
    const nextQuery = new URLSearchParams(query.toString());
    nextQuery.set("asset", assetId);
    router.push(`/comics/${comicId}/assets?${nextQuery.toString()}`, { scroll: false });
  };

  const closeAssetDetail = () => {
    const nextQuery = new URLSearchParams(query.toString());
    nextQuery.delete("asset");
    const suffix = nextQuery.toString();
    router.replace(`/comics/${comicId}/assets${suffix ? `?${suffix}` : ""}`, { scroll: false });
  };

  const importToCanvasList = async (asset: ComicAssetListItem) => {
    if (adding || !chapterId) return;
    setAdding(true);
    setError("");
    try {
      const workbench = await apiLoadWorkbench(chapterId);
      await apiImportAssetToCanvasList(workbench.ids.projectId, asset.id);
      setNotice(`已将「${asset.name}」导入当前画布资产列表`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "导入画布资产列表失败，请稍后重试。");
    } finally {
      setAdding(false);
    }
  };

  const briefs = comic ? [
    { id: "style" as const, icon: "ai" as const, eyebrow: "VISUAL STYLE", title: "视觉风格", description: "统一管理线条、色彩、光影、构图规则和风格图片。", value: comic.styleSummary, placeholder: "描述线条、色彩、媒介质感、镜头语言和希望避免的风格。", maxLength: 4000 },
    { id: "story" as const, icon: "storyboard" as const, eyebrow: "STORY CORE", title: "故事核心", description: "这部漫画最重要的故事承诺与核心冲突。", value: comic.summary, placeholder: "用一两段话说明主角、目标、冲突与故事吸引力。", maxLength: 2000, required: true },
    { id: "world" as const, icon: "context" as const, eyebrow: "WORLD", title: "世界设定", description: "跨章节保持一致的时代背景、规则与长期冲突。", value: comic.worldSummary, placeholder: "补充世界规则、时代背景、地域、组织或超自然机制。", maxLength: 4000 },
  ] : [];
  const activeBrief = briefs.find((brief) => brief.id === editingBrief);

  const closeBrief = () => {
    setEditingBrief(null);
    window.requestAnimationFrame(() => briefReturnFocus?.focus());
  };

  const saveBrief = async (value: string) => {
    if (!activeBrief) return;
    const input = activeBrief.id === "story" ? { summary: value } : activeBrief.id === "world" ? { worldSummary: value } : { styleSummary: value };
    const updated = await apiUpdateComic(comicId, input);
    setComic((current) => current ? { ...current, summary: updated.summary, worldSummary: updated.worldSummary, styleSummary: updated.styleSummary } : current);
    closeBrief();
    setNotice(`已更新「${activeBrief.title}」`);
  };

  const uploadVisualStyleReference = async (file: File) => {
    setVisualStyle(await apiUploadComicVisualStyleImage(comicId, file));
    setNotice("视觉风格图片已上传");
  };

  const renameVisualStyleReference = async (imageId: string, label: string) => {
    if (!visualStyle.assetId) throw new Error("视觉风格图片不存在。");
    const detail = await apiRenameAssetImage(visualStyle.assetId, imageId, label);
    setVisualStyle({ assetId: detail.root.id, images: detail.root.images });
  };

  const deleteVisualStyleReference = async (imageId: string) => {
    if (!visualStyle.assetId) throw new Error("视觉风格图片不存在。");
    const detail = await apiDeleteAssetImage(visualStyle.assetId, imageId);
    setVisualStyle({ assetId: detail.root.id, images: detail.root.images });
  };

  const saveAssetEntry = async (entryId: string, patch: { name?: string; description?: string }) => {
    const rootId = currentDetailResult?.detail?.root.id;
    const updated = await apiUpdateAsset(entryId, patch);
    setDetailResult((current) => {
      if (!current?.detail) return current;
      const updateEntry = (entry: ComicAssetDetail["root"]) => entry.id === entryId ? {
        ...entry,
        name: updated.name,
        description: updated.description,
        updatedAt: updated.updatedAt,
      } : entry;
      return { ...current, detail: { ...current.detail, root: updateEntry(current.detail.root), variants: current.detail.variants.map(updateEntry) } };
    });
    if (entryId === rootId) {
      setAssets((current) => current.map((asset) => asset.id === entryId ? { ...asset, name: updated.name, description: updated.description, updatedAt: updated.updatedAt } : asset));
    }
    setNotice(`已更新「${updated.name}」的资产资料`);
  };

  const applyImageMutation = (nextDetail: ComicAssetDetail) => {
    setDetailResult((current) => current ? { ...current, detail: nextDetail, error: "" } : current);
    const cover = nextDetail.root.images[0];
    setAssets((current) => current.map((asset) => asset.id === nextDetail.root.id ? {
      ...asset,
      versionId: cover?.versionId,
      contentUrl: cover?.contentUrl,
      updatedAt: nextDetail.root.updatedAt,
    } : asset));
  };

  const uploadAssetImage = async (entryId: string, file: File) => applyImageMutation(await apiUploadAssetImage(entryId, file));
  const setPrimaryImage = async (entryId: string, imageId: string) => applyImageMutation(await apiSetPrimaryAssetImage(entryId, imageId));
  const renameImage = async (entryId: string, imageId: string, label: string) => applyImageMutation(await apiRenameAssetImage(entryId, imageId, label));
  const deleteImage = async (entryId: string, imageId: string) => applyImageMutation(await apiDeleteAssetImage(entryId, imageId));
  const deleteAsset = async (assetId: string) => {
    const assetName = currentDetailResult?.detail?.root.name ?? "资产";
    const deleted = await apiDeleteAsset(assetId);
    setAssets((current) => current.filter((asset) => asset.id !== deleted.id));
    setDetailResult(null);
    closeAssetDetail();
    setNotice(`已删除资产“${assetName}”`);
  };

  return <main className={`comic-asset-studio-page app-surface route-page-transition ${entryTransition}`}>
    <header className="asset-studio-page-head app-page-wide">
      <button type="button" className="asset-studio-back app-page-corner-button" aria-label="返回" onClick={goBack}><Icon name="collapse" /></button>
      <button type="button" className="asset-studio-global-settings app-page-corner-button" aria-label="全局设置" onClick={() => navigate(`/settings?returnTo=${encodeURIComponent(`/comics/${comicId}/assets`)}`)}><Icon name="settings" /></button>
      <div className="asset-studio-page-title app-page-title">
        <span><Icon name="folder" /></span>
        <div><small>ASSET SPACE</small><h1>资产空间</h1></div>
      </div>
    </header>
    <section className="comic-brief-section app-page-wide" aria-labelledby="comic-brief-title">
      <header>
        <div><small>CREATIVE BASELINE</small><h2 id="comic-brief-title">创作基线</h2></div>
      </header>
      <div className="comic-brief-rail">
        {briefs.map((brief) => <button type="button" className={`comic-brief-card comic-brief-card-${brief.id}`} key={brief.id} aria-haspopup="dialog" onClick={(event) => { setBriefReturnFocus(event.currentTarget); setEditingBrief(brief.id); }}>
          <span className="comic-brief-card-icon"><Icon name={brief.icon} /></span>
          <span className="comic-brief-card-copy"><small>{brief.eyebrow}</small><b>{brief.title}</b><span className="comic-brief-card-value">{brief.value || brief.placeholder}</span></span>
        </button>)}
        {loading ? <div className="comic-brief-card comic-brief-card-skeleton" aria-label="正在读取创作基线" /> : null}
      </div>
    </section>
    <section className="comic-asset-library-section app-page-wide" aria-labelledby="comic-asset-library-title">
      <header><small>VISUAL ASSETS</small><h2 id="comic-asset-library-title">视觉资产</h2></header>
      <div className="comic-asset-studio-layout">
        <nav className="comic-asset-filter" aria-label="资产类型">
          {filters.map((item) => <button type="button" key={item.id} className={filter === item.id ? "active" : ""} onClick={() => setFilterState({ query: requestedFilter, value: item.id })}><span><Icon name={filterIcons[item.id]} /></span>{item.label}</button>)}
        </nav>
        <div className="comic-asset-content" aria-live="polite">
          {loading ? <div className="comic-asset-loading">正在整理资产…</div> : null}
          {!loading && !error ? <div className="comic-asset-grid"><button type="button" className="comic-asset-add-card" onClick={(event) => openAssetCreate(event.currentTarget)}><span className="comic-asset-add-card-content"><span><Icon name="add" /></span><b>{addLabel}</b><small>填写资料并按需上传图片</small></span></button>{visibleAssets.map((asset) => <article className="comic-asset-card" key={asset.id}><button type="button" className="asset-card-open" aria-haspopup="dialog" aria-expanded={selectedId === asset.id} onClick={(event) => openAssetDetail(asset.id, event.currentTarget)}><span className="comic-asset-image">{asset.contentUrl ? <img src={asset.contentUrl} alt={`${asset.name}资产封面`} loading="lazy" decoding="async" /> : <i>{assetKindTag(asset.kind)}</i>}{asset.variantCount ? <em>{asset.variantCount + 1} 形态</em> : null}</span><span className="comic-asset-meta"><b>{asset.name}</b><small><i>{assetKindTag(asset.kind)}</i>{assetKindLabel(asset.kind)}</small></span></button>{returnToWorkbench ? <button type="button" className="asset-card-add" data-tooltip="导入当前画布列表" aria-label={`将${asset.name}导入当前画布列表`} disabled={adding} onClick={() => void importToCanvasList(asset)}><Icon name="add" /></button> : null}</article>)}</div> : null}
        </div>
      </div>
    </section>
    {creatingAsset ? <AssetCreateDialog initialKind={initialCreateKind} onCreate={createAsset} onContinueWithAI={continueAssetWithAI} onClose={closeAssetCreate} /> : null}
    {selectedId ? <AssetDetailDialog key={selectedId} detail={currentDetailResult?.detail ?? null} loading={detailLoading} error={currentDetailResult?.error ?? ""} onClose={closeAssetDetail} onRetry={() => setDetailRequestKey((key) => key + 1)} onSaveEntry={saveAssetEntry} onUploadImage={uploadAssetImage} onSetPrimaryImage={setPrimaryImage} onRenameImage={renameImage} onDeleteImage={deleteImage} onDeleteAsset={deleteAsset} returnFocus={detailReturnFocus} /> : null}
    {activeBrief ? <ComicBriefDialog title={activeBrief.title} eyebrow={activeBrief.eyebrow} description={activeBrief.description} value={activeBrief.value} placeholder={activeBrief.placeholder} maxLength={activeBrief.maxLength} required={activeBrief.required} referenceImages={activeBrief.id === "style" ? visualStyle.images : undefined} onUploadReference={activeBrief.id === "style" ? uploadVisualStyleReference : undefined} onRenameReference={activeBrief.id === "style" ? renameVisualStyleReference : undefined} onDeleteReference={activeBrief.id === "style" ? deleteVisualStyleReference : undefined} onSave={saveBrief} onClose={closeBrief} /> : null}
    {error || notice ? <div className="asset-studio-toast" role="status">{error || notice}</div> : null}
  </main>;
}
