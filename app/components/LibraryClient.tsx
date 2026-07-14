"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCreateComic, apiListComics, type ComicListItem } from "@/app/lib/api-client";
import { CustomSelect } from "./CustomSelect";

export function LibraryClient() {
  const router = useRouter();
  const [comics, setComics] = useState<ComicListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({ title: "", summary: "", format: "page" as "page" | "vertical" | "four_panel" });
  const formatOptions = [
    { value: "page", label: "页漫", detail: "适合分页阅读", icon: "page" as const },
    { value: "vertical", label: "条漫", detail: "适合纵向滚动", icon: "vertical" as const },
    { value: "four_panel", label: "四格", detail: "即将开放", icon: "fourPanel" as const, disabled: true },
  ];

  useEffect(() => {
    let alive = true;
    void apiListComics()
      .then((page) => { if (alive) { setComics(page.items); setNextCursor(page.nextCursor); } })
      .catch(() => { if (alive) setError("漫画列表暂时无法加载"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await apiListComics(nextCursor);
      setComics((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setError("更多漫画暂时无法加载");
    } finally {
      setLoadingMore(false);
    }
  };

  const createComic = async () => {
    if (!draft.title.trim() || !draft.summary.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const created = await apiCreateComic({ ...draft, format: draft.format === "four_panel" ? "page" : draft.format, title: draft.title.trim(), summary: draft.summary.trim() });
      router.push(`/comics/${created.comic.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建漫画失败");
      setSubmitting(false);
    }
  };

  return <>
    <section className="comic-library" aria-label="漫画列表">
      <button type="button" className="library-add-comic-button" aria-label="新建漫画" onClick={() => setCreating(true)}><span aria-hidden="true" /></button>
      {error ? <p className="library-error">{error}</p> : null}
      {!loading && !error && !comics.length ? <div className="library-empty">
        <svg className="library-empty-border" aria-hidden="true"><rect /></svg>
        <button type="button" className="library-empty-add-button" aria-label="新建第一部漫画" onClick={() => setCreating(true)}><span aria-hidden="true" /></button>
        <strong>还没有漫画</strong>
        <p>新建第一部漫画，和 Agent 一起从故事企划开始。</p>
      </div> : null}
      {comics.map((comic) => {
        const latest = comic.chapters.at(-1);
        return <article className="comic-library-card" key={comic.id}>
          <button type="button" className="comic-library-open" onClick={() => router.push(`/comics/${comic.id}`)}>
            <div className="comic-cover">{comic.coverUrl ? <img src={comic.coverUrl} alt={`${comic.title}漫画封面`} loading="lazy" decoding="async" /> : <div className="comic-cover-placeholder" aria-label="尚未设置漫画封面"><b>{comic.title.slice(0, 2)}</b></div>}<span>{comic.chapters.length ? "创作中" : "待建章节"}</span></div>
            <div><small>{comic.format === "vertical" ? "条漫" : comic.format === "four_panel" ? "四格" : "页漫"}</small><h2>{comic.title}</h2><p>{comic.summary || "还没有故事简介。"}</p><strong>{latest ? `查看 ${comic.chapters.length} 话` : "先新建一话"} <span>→</span></strong></div>
          </button>
        </article>;
      })}
      {nextCursor ? <button type="button" className="library-load-more" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "正在加载…" : "加载更多漫画"}</button> : null}
    </section>
    {creating ? <div className="creation-dialog-backdrop" role="presentation" onMouseDown={() => setCreating(false)}><section className="creation-dialog" role="dialog" aria-modal="true" aria-labelledby="new-comic-title" onMouseDown={(event) => event.stopPropagation()}>
      <div><small>NEW COMIC</small><h2 id="new-comic-title">开始一个新故事</h2></div>
      <label>漫画名称<input autoFocus value={draft.title} placeholder="例如：雨夜便利店" onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label>
      <label>漫画简介<textarea value={draft.summary} placeholder="简单介绍这部漫画的故事、角色或氛围" onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} /></label>
      <label>漫画结构<CustomSelect ariaLabel="漫画结构" className="creation-select compact" value={draft.format === "four_panel" ? "page" : draft.format} options={formatOptions} onChange={(value) => setDraft((current) => ({ ...current, format: value as typeof current.format }))} /></label>
      {error ? <p className="creation-error">{error}</p> : null}
      <footer><button type="button" onClick={() => setCreating(false)}>取消</button><button type="button" className="primary" disabled={!draft.title.trim() || !draft.summary.trim() || submitting} onClick={() => void createComic()}>{submitting ? "正在创建…" : "创建漫画"}</button></footer>
    </section></div> : null}
  </>;
}
