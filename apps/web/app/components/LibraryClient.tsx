"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCreateComic, apiListComics, type ComicListItem } from "@/app/lib/api-client";
import { navigateWithContentTransition } from "@/app/lib/content-route-transition";
import { CustomSelect } from "./CustomSelect";
import { AppDialogPortal } from "./AppDialogPortal";
import { uiCopy } from "@/app/lib/ui-copy";

const CREATE_COMIC_EVENT = "lantern:create-comic";

function creationStatusLabel(status: ComicListItem["status"]) {
  return status === "completed" ? uiCopy.comic.creationStatus.complete : uiCopy.comic.creationStatus.creating;
}

export function LibraryClient() {
  const router = useRouter();
  const [comics, setComics] = useState<ComicListItem[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({ title: "", summary: "", format: "page" as "page" | "vertical" | "four_panel" });
  const formatOptions = [
    { value: "page", label: uiCopy.comic.format.page, detail: uiCopy.library.form.pageFormatHint, icon: "page" as const },
    { value: "vertical", label: uiCopy.comic.format.vertical, detail: uiCopy.library.form.verticalFormatHint, icon: "vertical" as const },
    { value: "four_panel", label: uiCopy.comic.format.fourPanel, detail: uiCopy.common.status.comingSoon, icon: "fourPanel" as const, disabled: true },
  ];

  useEffect(() => {
    let alive = true;
    void apiListComics()
      .then((page) => { if (alive) { setComics(page.items); setNextCursor(page.nextCursor); } })
      .catch(() => { if (alive) setError(uiCopy.library.error.listLoadFailed); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const openCreateDialog = () => setCreating(true);
    window.addEventListener(CREATE_COMIC_EVENT, openCreateDialog);
    return () => window.removeEventListener(CREATE_COMIC_EVENT, openCreateDialog);
  }, []);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await apiListComics(nextCursor);
      setComics((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setError(uiCopy.library.error.moreLoadFailed);
    } finally {
      setLoadingMore(false);
    }
  };

  const createComic = async () => {
    if (!draft.title.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const created = await apiCreateComic({ ...draft, format: draft.format === "four_panel" ? "page" : draft.format, title: draft.title.trim(), summary: draft.summary.trim() });
      navigateWithContentTransition("forward", () => router.push(`/comics/${created.comic.id}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : uiCopy.library.error.createFailed);
      setSubmitting(false);
    }
  };

  return <>
    <section className="comic-library app-page-wide" aria-label={uiCopy.library.navigation.listAria}>
      {error ? <p className="library-error">{error}</p> : null}
      {comics.map((comic) => {
        const latest = comic.chapters.at(-1);
        return <article className="comic-library-card" key={comic.id}>
          <button type="button" className="comic-library-open" onClick={() => navigateWithContentTransition("forward", () => router.push(`/comics/${comic.id}`))}>
            <div className="comic-cover">{comic.coverUrl ? <img src={comic.coverUrl} alt={uiCopy.library.cover.comicAlt(comic.title)} loading="lazy" decoding="async" /> : <div className="comic-cover-placeholder" aria-label={uiCopy.library.cover.missingAria}><b>{comic.title.slice(0, 2)}</b></div>}{comic.isExample ? <span className="example">{uiCopy.library.badge.exampleComic}</span> : <span className={`comic-status ${comic.status}`}>{creationStatusLabel(comic.status)}</span>}</div>
            <div><small>{comic.format === "vertical" ? uiCopy.comic.format.vertical : comic.format === "four_panel" ? uiCopy.comic.format.fourPanel : uiCopy.comic.format.page}</small><h2>{comic.title}</h2><p>{comic.summary || uiCopy.library.summary.empty}</p><strong>{latest ? uiCopy.library.summary.chapterCount(comic.chapters.length) : uiCopy.library.empty.chapterPrompt} <span>→</span></strong></div>
          </button>
        </article>;
      })}
      {nextCursor ? <button type="button" className="library-load-more" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? uiCopy.library.progress.loadingMore : uiCopy.library.action.loadMore}</button> : null}
    </section>
    {creating ? <AppDialogPortal><div className="creation-dialog-backdrop" role="presentation" onMouseDown={() => setCreating(false)}><section className="creation-dialog" role="dialog" aria-modal="true" aria-labelledby="new-comic-title" onMouseDown={(event) => event.stopPropagation()}>
      <div><small>{uiCopy.eyebrow.newComic}</small><h2 id="new-comic-title">{uiCopy.library.empty.creationTitle}</h2></div>
      <label>{uiCopy.comic.field.name}<input autoFocus value={draft.title} placeholder={uiCopy.comic.field.name} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label>
      <label>{uiCopy.comic.field.description}<textarea value={draft.summary} placeholder={uiCopy.library.form.descriptionPlaceholder} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} /></label>
      <label>{uiCopy.library.form.structureLabel}<CustomSelect ariaLabel={uiCopy.library.form.structureLabel} className="creation-select compact" value={draft.format === "four_panel" ? "page" : draft.format} options={formatOptions} onChange={(value) => setDraft((current) => ({ ...current, format: value as typeof current.format }))} /></label>
      {error ? <p className="creation-error">{error}</p> : null}
      <footer><button type="button" onClick={() => setCreating(false)}>{uiCopy.common.action.cancel}</button><button type="button" className="primary" disabled={!draft.title.trim() || submitting} onClick={() => void createComic()}>{submitting ? uiCopy.common.progress.creating : uiCopy.library.action.createComic}</button></footer>
    </section></div></AppDialogPortal> : null}
  </>;
}

export function LibraryCreateComicButton() {
  return <button type="button" className="library-add-comic-button" aria-label={uiCopy.library.navigation.newComicAria} onClick={() => window.dispatchEvent(new Event(CREATE_COMIC_EVENT))}><span aria-hidden="true" /></button>;
}
