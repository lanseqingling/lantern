"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@lantern/ui";
import { AssetCreateDialog } from "@/app/components/AssetCreateDialog";
import { AssetDetailDialog } from "@/app/components/AssetDetailDialog";
import { ComicBriefDialog } from "@/app/components/ComicBriefDialog";
import { assetKindLabel, assetKindTag } from "@/app/lib/asset-kind";
import { uiCopy } from "@/app/lib/ui-copy";
import { navigateWithContentTransition, useContentRouteEntryTransition } from "@/app/lib/content-route-transition";
import { apiCreateComicAsset, apiDeleteAsset, apiDeleteAssetImage, apiGetAssetDetail, apiGetComic, apiGetComicVisualStyle, apiImportAssetToCanvasList, apiListComicAssets, apiLoadWorkbench, apiRenameAssetImage, apiSetPrimaryAssetImage, apiUpdateAsset, apiUpdateComic, apiUploadAssetImage, apiUploadComicVisualStyleImage, type ComicAssetDetail, type ComicAssetListItem, type ComicListItem, type ComicVisualStyle } from "@/app/lib/api-client";

type AssetFilter = "all" | "character" | "scene" | "prop" | "reference";
type BriefId = "story" | "world" | "style";
type AssetCreateKind = "character" | "scene" | "prop" | "reference_image";

const filters: Array<{ id: AssetFilter; label: string; kinds?: ComicAssetListItem["kind"][] }> = [
  { id: "all", label: uiCopy.asset.page.allFilter },
  { id: "character", label: uiCopy.asset.kind.character, kinds: ["character"] },
  { id: "scene", label: uiCopy.asset.kind.scene, kinds: ["scene"] },
  { id: "prop", label: uiCopy.asset.kind.prop, kinds: ["prop"] },
  // Image assets only arrive here through an explicit user upload/add.
  // Page-owned generated frame images are intentionally absent.
  { id: "reference", label: uiCopy.asset.kind.image, kinds: ["reference_image"] },
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
      .catch((reason) => { if (!canceled) setError(reason instanceof Error ? reason.message : uiCopy.toast.assetSpace.loadFailed); })
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
      .catch((reason) => { if (!canceled) setDetailResult({ assetId: selectedId, requestKey: detailRequestKey, detail: null, error: reason instanceof Error ? reason.message : uiCopy.asset.error.detailLoadFailed }); });
    return () => { canceled = true; };
  }, [selectedId, detailRequestKey]);
  const currentDetailResult = detailResult?.assetId === selectedId && detailResult.requestKey === detailRequestKey ? detailResult : null;
  const detailLoading = Boolean(selectedId && !currentDetailResult);

  const navigate = (href: string, direction: "forward" | "back" = "forward") => navigateWithContentTransition(direction, () => router.push(href));
  const goBack = () => navigate(returnToWorkbench ? `/comics/${comicId}/chapters/${chapterId}` : `/comics/${comicId}`, "back");
  const addLabel = ({ all: uiCopy.asset.create.title, character: uiCopy.asset.action.addCharacter, scene: uiCopy.asset.action.addScene, prop: uiCopy.asset.action.addProp, reference: uiCopy.asset.action.addImage } as const)[filter];
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
    setNotice(uiCopy.toast.assetSpace.created(detail.root.name));
  };

  const continueAssetWithAI = async (input: { kind: AssetCreateKind; name: string; description: string }) => {
    const targetChapterId = chapterId ?? comic?.chapters.at(-1)?.id;
    if (!targetChapterId) throw new Error(uiCopy.asset.create.chapterRequired);
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
      setNotice(uiCopy.toast.assetSpace.importedToCanvas(asset.name));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : uiCopy.toast.assetSpace.importFailed);
    } finally {
      setAdding(false);
    }
  };

  const briefs = comic ? [
    { id: "style" as const, icon: "ai" as const, eyebrow: uiCopy.asset.eyebrow.visualStyle, title: uiCopy.asset.baseline.visualStyle.title, description: uiCopy.asset.baseline.visualStyle.description, value: comic.styleSummary, placeholder: uiCopy.asset.baseline.visualStyle.placeholder, maxLength: 4000 },
    { id: "story" as const, icon: "storyboard" as const, eyebrow: uiCopy.asset.eyebrow.storyCore, title: uiCopy.asset.baseline.storyCore.title, description: uiCopy.asset.baseline.storyCore.description, value: comic.summary, placeholder: uiCopy.asset.baseline.storyCore.placeholder, maxLength: 2000, required: true },
    { id: "world" as const, icon: "context" as const, eyebrow: uiCopy.asset.eyebrow.world, title: uiCopy.asset.baseline.worldSetting.title, description: uiCopy.asset.baseline.worldSetting.description, value: comic.worldSummary, placeholder: uiCopy.asset.baseline.worldSetting.placeholder, maxLength: 4000 },
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
    setNotice(uiCopy.toast.assetSpace.briefUpdated(activeBrief.title));
  };

  const uploadVisualStyleReference = async (file: File) => {
    setVisualStyle(await apiUploadComicVisualStyleImage(comicId, file));
    setNotice(uiCopy.toast.assetSpace.visualStyleImageUploaded);
  };

  const renameVisualStyleReference = async (imageId: string, label: string) => {
    if (!visualStyle.assetId) throw new Error(uiCopy.asset.error.visualStyleImageMissing);
    const detail = await apiRenameAssetImage(visualStyle.assetId, imageId, label);
    setVisualStyle({ assetId: detail.root.id, images: detail.root.images });
  };

  const deleteVisualStyleReference = async (imageId: string) => {
    if (!visualStyle.assetId) throw new Error(uiCopy.asset.error.visualStyleImageMissing);
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
    setNotice(uiCopy.toast.assetSpace.detailsUpdated(updated.name));
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
    const assetName = currentDetailResult?.detail?.root.name ?? uiCopy.asset.label.asset;
    const deleted = await apiDeleteAsset(assetId);
    setAssets((current) => current.filter((asset) => asset.id !== deleted.id));
    setDetailResult(null);
    closeAssetDetail();
    setNotice(uiCopy.toast.assetSpace.deleted(assetName));
  };

  return <main className={`comic-asset-studio-page app-surface route-page-transition ${entryTransition}`}>
    <header className="asset-studio-page-head app-page-wide">
      <button type="button" className="asset-studio-back app-page-corner-button" aria-label={uiCopy.common.action.back} onClick={goBack}><Icon name="collapse" /></button>
      <button type="button" className="asset-studio-global-settings app-page-corner-button" aria-label={uiCopy.common.navigation.globalSettings} onClick={() => navigate(`/settings?returnTo=${encodeURIComponent(`/comics/${comicId}/assets`)}`)}><Icon name="settings" /></button>
      <div className="asset-studio-page-title app-page-title">
        <span><Icon name="folder" /></span>
        <div><small>{uiCopy.asset.eyebrow.space}</small><h1>{uiCopy.asset.navigation.space}</h1></div>
      </div>
    </header>
    <section className="comic-brief-section app-page-wide" aria-labelledby="comic-brief-title">
      <header>
        <div><small>{uiCopy.asset.eyebrow.creativeBaseline}</small><h2 id="comic-brief-title">{uiCopy.asset.page.baselineTitle}</h2></div>
      </header>
      <div className="comic-brief-rail">
        {briefs.map((brief) => <button type="button" className={`comic-brief-card comic-brief-card-${brief.id}`} key={brief.id} aria-haspopup="dialog" onClick={(event) => { setBriefReturnFocus(event.currentTarget); setEditingBrief(brief.id); }}>
          <span className="comic-brief-card-icon"><Icon name={brief.icon} /></span>
          <span className="comic-brief-card-copy"><small>{brief.eyebrow}</small><b>{brief.title}</b><span className="comic-brief-card-value">{brief.value || brief.placeholder}</span></span>
        </button>)}
        {loading ? <div className="comic-brief-card comic-brief-card-skeleton" aria-label={uiCopy.asset.page.baselineLoadingAria} /> : null}
      </div>
    </section>
    <section className="comic-asset-library-section app-page-wide" aria-labelledby="comic-asset-library-title">
      <header><small>{uiCopy.brand.visualAssets}</small><h2 id="comic-asset-library-title">{uiCopy.asset.page.visualAssetsTitle}</h2></header>
      <div className="comic-asset-studio-layout">
        <nav className="comic-asset-filter" aria-label={uiCopy.asset.label.type}>
          {filters.map((item) => <button type="button" key={item.id} className={filter === item.id ? "active" : ""} onClick={() => setFilterState({ query: requestedFilter, value: item.id })}><span><Icon name={filterIcons[item.id]} /></span>{item.label}</button>)}
        </nav>
        <div className="comic-asset-content" aria-live="polite">
          {loading ? <div className="comic-asset-loading">{uiCopy.asset.page.organizing}</div> : null}
          {!loading && !error ? <div className="comic-asset-grid"><button type="button" className="comic-asset-add-card" onClick={(event) => openAssetCreate(event.currentTarget)}><span className="comic-asset-add-card-content"><span><Icon name="add" /></span><b>{addLabel}</b><small>{uiCopy.asset.page.visualAssetsHint}</small></span></button>{visibleAssets.map((asset) => <article className="comic-asset-card" key={asset.id}><button type="button" className="asset-card-open" aria-haspopup="dialog" aria-expanded={selectedId === asset.id} onClick={(event) => openAssetDetail(asset.id, event.currentTarget)}><span className="comic-asset-image">{asset.contentUrl ? <img src={asset.contentUrl} alt={uiCopy.asset.image.coverAlt(asset.name)} loading="lazy" decoding="async" /> : <i>{assetKindTag(asset.kind)}</i>}{asset.variantCount ? <em>{asset.variantCount + 1} {uiCopy.asset.label.variant}</em> : null}</span><span className="comic-asset-meta"><b>{asset.name}</b><small><i>{assetKindTag(asset.kind)}</i>{assetKindLabel(asset.kind)}</small></span></button>{returnToWorkbench ? <button type="button" className="asset-card-add" data-tooltip={uiCopy.asset.action.importToCanvasList} aria-label={uiCopy.asset.aria.importToCanvasList(asset.name)} disabled={adding} onClick={() => void importToCanvasList(asset)}><Icon name="add" /></button> : null}</article>)}</div> : null}
        </div>
      </div>
    </section>
    {creatingAsset ? <AssetCreateDialog initialKind={initialCreateKind} onCreate={createAsset} onContinueWithAI={continueAssetWithAI} onClose={closeAssetCreate} /> : null}
    {selectedId ? <AssetDetailDialog key={selectedId} detail={currentDetailResult?.detail ?? null} loading={detailLoading} error={currentDetailResult?.error ?? ""} onClose={closeAssetDetail} onRetry={() => setDetailRequestKey((key) => key + 1)} onSaveEntry={saveAssetEntry} onUploadImage={uploadAssetImage} onSetPrimaryImage={setPrimaryImage} onRenameImage={renameImage} onDeleteImage={deleteImage} onDeleteAsset={deleteAsset} returnFocus={detailReturnFocus} /> : null}
    {activeBrief ? <ComicBriefDialog title={activeBrief.title} eyebrow={activeBrief.eyebrow} description={activeBrief.description} value={activeBrief.value} placeholder={activeBrief.placeholder} maxLength={activeBrief.maxLength} required={activeBrief.required} referenceImages={activeBrief.id === "style" ? visualStyle.images : undefined} onUploadReference={activeBrief.id === "style" ? uploadVisualStyleReference : undefined} onRenameReference={activeBrief.id === "style" ? renameVisualStyleReference : undefined} onDeleteReference={activeBrief.id === "style" ? deleteVisualStyleReference : undefined} onSave={saveBrief} onClose={closeBrief} /> : null}
    {error || notice ? <div className="asset-studio-toast" role="status">{error || notice}</div> : null}
  </main>;
}
