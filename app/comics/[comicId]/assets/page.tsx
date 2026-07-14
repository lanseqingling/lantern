"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/packages/ui/src";
import { apiImportAssetToCanvasList, apiListComicAssets, apiLoadWorkbench, type ComicAssetListItem } from "@/app/lib/api-client";

type AssetFilter = "all" | "character" | "scene" | "prop" | "reference";

const filters: Array<{ id: AssetFilter; label: string; kinds?: ComicAssetListItem["kind"][] }> = [
  { id: "all", label: "全部" },
  { id: "character", label: "角色", kinds: ["character"] },
  { id: "scene", label: "场景", kinds: ["scene"] },
  { id: "prop", label: "道具", kinds: ["prop"] },
  // Reference images only arrive here through an explicit user upload/add.
  // Page-owned generated frame images are intentionally absent.
  { id: "reference", label: "参考", kinds: ["reference_image"] },
];

const filterIcons = { all: "assetAll", character: "user", scene: "scene", prop: "prop", reference: "referenceImage" } as const;

function assetKindLabel(kind: ComicAssetListItem["kind"]) {
  return ({ character: "角色", scene: "场景", prop: "道具", style: "风格", sketch: "草图", reference_image: "参考", generated_image: "图片" } as const)[kind];
}

function assetKindGlyph(kind: ComicAssetListItem["kind"]) {
  return kind === "character" ? "人" : kind === "scene" ? "景" : kind === "prop" ? "物" : "图";
}

/** Comic-level reusable assets. A chapter only stores its own canvas placements. */
export default function ComicAssetsPage() {
  const router = useRouter();
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
  const [selectedId, setSelectedId] = useState<string | null>(query.get("asset"));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let canceled = false;
    void apiListComicAssets(comicId)
      .then((items) => { if (!canceled) { setAssets(items); setError(""); } })
      .catch((reason) => { if (!canceled) setError(reason instanceof Error ? reason.message : "资产暂时无法读取。"); })
      .finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, [comicId]);
  const selected = assets.find((asset) => asset.id === selectedId) ?? null;
  const visibleAssets = useMemo(() => {
    const active = filters.find((item) => item.id === filter);
    return active?.kinds ? assets.filter((asset) => active.kinds?.includes(asset.kind)) : assets;
  }, [assets, filter]);
  useEffect(() => {
    if (selectedId && visibleAssets.some((asset) => asset.id === selectedId)) return;
    const timer = window.setTimeout(() => setSelectedId(visibleAssets[0]?.id ?? null), 0);
    return () => window.clearTimeout(timer);
  }, [selectedId, visibleAssets]);
  const goBack = () => router.push(returnToWorkbench ? `/comics/${comicId}/chapters/${chapterId}` : `/comics/${comicId}`);
  const addKind = filter === "all" ? "asset" : filter;
  const addLabel = ({ all: "添加资产", character: "添加角色", scene: "添加场景", prop: "添加道具", reference: "添加参考图" } as const)[filter];
  const openAssetCreate = () => {
    if (!chapterId) {
      setNotice("请先进入一话工作区，再创建或上传资产。");
      return;
    }
    router.push(`/comics/${comicId}/chapters/${chapterId}?assetCreate=${encodeURIComponent(addKind)}`);
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

  return <main className="comic-asset-studio-page">
    <header className="asset-studio-page-head">
      <button type="button" aria-label="返回" onClick={goBack}><Icon name="collapse" /></button>
      <div><small>ASSET SPACE</small><h1>资产空间</h1><p>在这里整理本漫画可复用的角色、场景与道具。</p></div>
    </header>
    <div className="comic-asset-studio-layout">
      <nav className="comic-asset-filter" aria-label="资产类型">
        {filters.map((item) => <button type="button" key={item.id} className={filter === item.id ? "active" : ""} onClick={() => setFilterState({ query: requestedFilter, value: item.id })}><span><Icon name={filterIcons[item.id]} /></span>{item.label}</button>)}
      </nav>
      <section className="comic-asset-content" aria-live="polite">
        <div className="asset-studio-content-head"><span>{filters.find((item) => item.id === filter)?.label}</span><small>{visibleAssets.length} 个资产</small></div>
        {loading ? <div className="comic-asset-loading">正在整理资产…</div> : null}
        {!loading && !error ? <div className="comic-asset-grid"><button type="button" className="comic-asset-add-card" onClick={openAssetCreate}><span><Icon name="add" /></span><b>{addLabel}</b><small>{filter === "reference" ? "上传或加入参考图" : "在当前工作区与 Agent 创建"}</small></button>{visibleAssets.map((asset) => <article className={`comic-asset-card ${selected?.id === asset.id ? "selected" : ""}`} key={asset.id}><button type="button" className="asset-card-open" onClick={() => setSelectedId(asset.id)}><span className="comic-asset-image">{asset.contentUrl ? <img src={asset.contentUrl} alt="" /> : <i>{assetKindGlyph(asset.kind)}</i>}</span><span className="comic-asset-meta"><b>{asset.name}</b><small><i>{assetKindGlyph(asset.kind)}</i>{assetKindLabel(asset.kind)}</small></span></button>{returnToWorkbench ? <button type="button" className="asset-card-add" data-tooltip="导入当前画布列表" aria-label={`将${asset.name}导入当前画布列表`} disabled={adding} onClick={() => void importToCanvasList(asset)}><Icon name="add" /></button> : null}</article>)}</div> : null}
      </section>
      {selected ? <aside key={selected.id} className="asset-config-panel" aria-label={`${selected.name}资产设置`}>
        <div className="asset-config-image">{selected.contentUrl ? <img src={selected.contentUrl} alt={selected.name} /> : <span>{assetKindGlyph(selected.kind)}</span>}</div>
        <p><i>{assetKindGlyph(selected.kind)}</i>{assetKindLabel(selected.kind)}</p>
        <div className="asset-config-summary"><div><small>名称</small><strong>{selected.name}</strong></div><div><small>描述</small><p>{selected.description || "暂无描述"}</p></div></div>
      </aside> : null}
    </div>
    {error || notice ? <div className="asset-studio-toast" role="status">{error || notice}</div> : null}
  </main>;
}
