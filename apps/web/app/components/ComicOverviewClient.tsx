"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  apiCreateChapter,
  apiDeleteChapter,
  apiDeleteComic,
  apiDuplicateComic,
  apiGetComic,
  apiUpdateChapter,
  apiUpdateComic,
  apiUploadChapterCover,
  apiUploadComicCover,
  type ComicListItem,
} from "@/app/lib/api-client";
import { Icon } from "@lantern/ui";
import { navigateWithContentTransition } from "@/app/lib/content-route-transition";
import { CustomSelect } from "./CustomSelect";
import { AppDialogPortal } from "./AppDialogPortal";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { uiCopy } from "@/app/lib/ui-copy";

const readingDirectionOptions = [
  { value: "ltr", label: uiCopy.comic.readingDirection.leftToRight },
  { value: "rtl", label: uiCopy.comic.readingDirection.rightToLeft, disabled: true },
];
const creationStatusOptions = [
  { value: "in_progress", label: uiCopy.comic.creationStatus.creating },
  { value: "completed", label: uiCopy.comic.creationStatus.complete },
];

function creationStatusLabel(status: "in_progress" | "completed") {
  return status === "completed" ? uiCopy.comic.creationStatus.complete : uiCopy.comic.creationStatus.creating;
}

export function ComicOverviewClient({ comicId }: { comicId: string }) {
  const router = useRouter();
  const navigate = (href: string, direction: "forward" | "back" = "forward") => navigateWithContentTransition(direction, () => router.push(href));
  const comicCoverInputRef = useRef<HTMLInputElement>(null);
  const chapterCoverInputRef = useRef<HTMLInputElement>(null);
  const comicMenuRef = useRef<HTMLDivElement>(null);
  const chapterMenuRef = useRef<HTMLDivElement>(null);
  const [comic, setComic] = useState<ComicListItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingComic, setDeletingComic] = useState(false);
  const [duplicatingComic, setDuplicatingComic] = useState(false);
  const [deletingChapterId, setDeletingChapterId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chapterMenuId, setChapterMenuId] = useState<string | null>(null);
  const [chapterMenuOpensUpward, setChapterMenuOpensUpward] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chapterSettingsId, setChapterSettingsId] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingChapterSettings, setSavingChapterSettings] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [pendingChapterCoverId, setPendingChapterCoverId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ type: "comic" } | { type: "chapter"; chapter: ComicListItem["chapters"][number] } | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [draft, setDraft] = useState({ title: "", summary: "" });
  const [settingsDraft, setSettingsDraft] = useState<{ title: string; summary: string; defaultReadingDirection: "ltr" | "rtl"; status: "in_progress" | "completed" }>({ title: "", summary: "", defaultReadingDirection: "ltr", status: "in_progress" });
  const [chapterSettingsDraft, setChapterSettingsDraft] = useState<{ title: string; summary: string; status: "in_progress" | "completed" }>({ title: "", summary: "", status: "in_progress" });

  const reloadComic = async () => {
    setComic(await apiGetComic(comicId));
  };

  useEffect(() => {
    let alive = true;
    void apiGetComic(comicId)
      .then((next) => {
        if (alive) {
          setComic(next);
          if (next) setSettingsDraft({ title: next.title, summary: next.summary, defaultReadingDirection: next.defaultReadingDirection, status: next.status });
        }
      })
      .catch(() => {
        if (alive) setError(uiCopy.comic.overview.error.loadFailed);
      });
    return () => { alive = false; };
  }, [comicId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!menuOpen && !chapterMenuId) return;
    const closeMenus = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuOpen && !comicMenuRef.current?.contains(target)) setMenuOpen(false);
      if (chapterMenuId && !chapterMenuRef.current?.contains(target)) setChapterMenuId(null);
    };
    document.addEventListener("pointerdown", closeMenus);
    return () => document.removeEventListener("pointerdown", closeMenus);
  }, [menuOpen, chapterMenuId]);

  useLayoutEffect(() => {
    if (!chapterMenuId || !chapterMenuRef.current) {
      setChapterMenuOpensUpward(false);
      return;
    }
    const positionMenu = () => {
      const menu = chapterMenuRef.current?.querySelector<HTMLElement>(".chapter-more-menu");
      if (menu) setChapterMenuOpensUpward(menu.getBoundingClientRect().bottom > window.innerHeight - 12);
    };
    positionMenu();
    window.addEventListener("resize", positionMenu);
    return () => window.removeEventListener("resize", positionMenu);
  }, [chapterMenuId]);

  const notify = (message: string) => setToast(message);
  const uploadErrorMessage = (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : "";
    if (/50MB/.test(message)) return uiCopy.toast.comicOverview.upload.imageTooLarge;
    if (/PNG|JPEG|WebP|请选择/.test(message)) return uiCopy.toast.comicOverview.upload.invalidFormat;
    return uiCopy.toast.comicOverview.upload.failed;
  };
  const deleteErrorMessage = (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : "";
    if (/任务|task/i.test(message)) return uiCopy.toast.comicOverview.deletion.stopRunningTask;
    if (/服务|不可用|fetch|network|failed/i.test(message)) return uiCopy.toast.comicOverview.deletion.serviceUnavailable;
    return uiCopy.toast.comicOverview.deletion.failed;
  };

  const createChapter = async () => {
    if (!draft.title.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const created = await apiCreateChapter(comicId, { title: draft.title.trim(), summary: draft.summary.trim() });
      navigate(`/comics/${comicId}/chapters/${created.chapterId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : uiCopy.comic.overview.error.createChapterFailed);
      setSubmitting(false);
    }
  };

  const saveSettings = async () => {
    if (!comic || !settingsDraft.title.trim() || !settingsDraft.summary.trim() || savingSettings) return;
    setSavingSettings(true);
    setError("");
    try {
      const updated = await apiUpdateComic(comic.id, { title: settingsDraft.title.trim(), summary: settingsDraft.summary.trim(), defaultReadingDirection: settingsDraft.defaultReadingDirection, status: settingsDraft.status });
      const status = updated.status.toLowerCase() as "in_progress" | "completed";
      setComic((current) => current ? { ...current, title: updated.title, summary: updated.summary, defaultReadingDirection: updated.defaultReadingDirection.toLowerCase() as "ltr" | "rtl", status } : current);
      setSettingsOpen(false);
      setMenuOpen(false);
      notify(uiCopy.toast.comicOverview.settings.comicSaved(creationStatusLabel(status)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : uiCopy.comic.overview.error.saveComicFailed);
    } finally {
      setSavingSettings(false);
    }
  };

  const saveChapterSettings = async () => {
    if (!comic || !chapterSettingsId || !chapterSettingsDraft.title.trim() || !chapterSettingsDraft.summary.trim() || savingChapterSettings) return;
    setSavingChapterSettings(true);
    setError("");
    try {
      const updated = await apiUpdateChapter(comic.id, chapterSettingsId, { title: chapterSettingsDraft.title.trim(), summary: chapterSettingsDraft.summary.trim(), status: chapterSettingsDraft.status });
      const status = updated.status.toLowerCase() as "in_progress" | "completed";
      setComic((current) => current ? { ...current, chapters: current.chapters.map((chapter) => chapter.id === chapterSettingsId ? { ...chapter, title: updated.title, summary: updated.summary, status } : chapter) } : current);
      setChapterSettingsId(null);
      setChapterMenuId(null);
      notify(uiCopy.toast.comicOverview.settings.chapterSaved(creationStatusLabel(status)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : uiCopy.comic.overview.error.saveChapterFailed);
    } finally {
      setSavingChapterSettings(false);
    }
  };

  const uploadComicCover = async (file?: File) => {
    if (!comic || !file || uploadingCover) return;
    setUploadingCover(true);
    setError("");
    try {
      const { coverUrl } = await apiUploadComicCover(comic.id, file);
      setComic((current) => current ? { ...current, coverUrl } : current);
      setMenuOpen(false);
    } catch (cause) {
      notify(uploadErrorMessage(cause));
    } finally {
      setUploadingCover(false);
    }
  };

  const uploadChapterCover = async (file?: File) => {
    if (!comic || !file || !pendingChapterCoverId || uploadingCover) return;
    const targetId = pendingChapterCoverId;
    setUploadingCover(true);
    setError("");
    try {
      const { coverUrl } = await apiUploadChapterCover(comic.id, targetId, file);
      setComic((current) => current ? { ...current, chapters: current.chapters.map((chapter) => chapter.id === targetId ? { ...chapter, coverUrl } : chapter) } : current);
      setChapterMenuId(null);
    } catch (cause) {
      notify(uploadErrorMessage(cause));
    } finally {
      setUploadingCover(false);
      setPendingChapterCoverId(null);
    }
  };

  const removeChapter = async (chapter: ComicListItem["chapters"][number]) => {
    if (deletingChapterId) return;
    setDeletingChapterId(chapter.id);
    setError("");
    try {
      await apiDeleteChapter(comicId, chapter.id);
      await reloadComic();
      notify(uiCopy.toast.comicOverview.deletion.chapterDeleted);
    } catch (cause) {
      notify(deleteErrorMessage(cause));
    } finally {
      setDeletingChapterId(null);
      setChapterMenuId(null);
      setConfirmDelete(null);
    }
  };

  const removeComic = async () => {
    if (!comic || deletingComic) return;
    setDeletingComic(true);
    setError("");
    try {
      await apiDeleteComic(comic.id);
      notify(uiCopy.toast.comicOverview.deletion.comicDeleted);
      navigate("/workspace", "back");
    } catch (cause) {
      notify(deleteErrorMessage(cause));
      setDeletingComic(false);
      setConfirmDelete(null);
    }
  };

  const duplicateComic = async () => {
    if (!comic || duplicatingComic) return;
    setDuplicatingComic(true);
    setError("");
    try {
      const copied = await apiDuplicateComic(comic.id);
      notify(uiCopy.toast.comicOverview.duplication.completed);
      setMenuOpen(false);
      navigate(`/comics/${copied.comicId}`);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : uiCopy.toast.comicOverview.duplication.failed);
    } finally {
      setDuplicatingComic(false);
    }
  };

  if (!comic) return <section className="chapter-loading">{error || uiCopy.comic.overview.progress.loading}</section>;
  const chapterSettingsChapter = chapterSettingsId ? comic.chapters.find((chapter) => chapter.id === chapterSettingsId) : null;

  return <>
    <header>
      <div className="chapter-top-left">
        <div className="comic-settings-wrap" ref={comicMenuRef}>
          <button type="button" className="comic-settings-trigger app-page-corner-button" aria-label={uiCopy.comic.overview.action.openProjectMenu} aria-expanded={menuOpen} onClick={() => { setMenuOpen((open) => !open); setChapterMenuId(null); }}><Icon name="projectMenu" /></button>
          {menuOpen ? <div className="comic-settings-menu" role="menu">
            <button type="button" onClick={() => { setSettingsDraft({ title: comic.title, summary: comic.summary, defaultReadingDirection: comic.defaultReadingDirection, status: comic.status }); setSettingsOpen(true); setMenuOpen(false); }}><Icon name="comicSettings" /><span>{uiCopy.comic.overview.action.openSettings}</span></button>
            <button type="button" onClick={() => navigate(`/comics/${comic.id}/assets`)}><Icon name="folder" /><span>{uiCopy.asset.navigation.space}</span></button>
            <button type="button" disabled={duplicatingComic} onClick={() => void duplicateComic()}><Icon name="copy" /><span>{duplicatingComic ? uiCopy.common.progress.copyingPlain : uiCopy.comic.overview.action.duplicateComic}</span></button>
            <button type="button" disabled={deletingComic} onClick={() => setConfirmDelete({ type: "comic" })}><Icon name="delete" /><span>{deletingComic ? uiCopy.common.progress.deletingPlain : uiCopy.comic.overview.action.deleteComic}</span></button>
          </div> : null}
        </div>
      </div>
      <div className="chapter-top-right">
        <div className="global-header-actions" aria-label={uiCopy.common.navigation.globalEntry}>
          <button type="button" className="chapter-add-button" aria-label={uiCopy.comic.overview.action.newChapter} onClick={() => { setDraft({ title: "", summary: "" }); setCreating(true); }}><span aria-hidden="true" /></button>
          <button type="button" className="global-icon-button app-page-corner-button" aria-label={uiCopy.common.navigation.globalSettings} onClick={() => navigate(`/settings?returnTo=${encodeURIComponent(`/comics/${comicId}`)}`)}><Icon name="settings" /></button>
        </div>
      </div>
    </header>
    <input ref={comicCoverInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp,.png,.jpg,.jpeg,.webp" hidden onChange={(event) => { void uploadComicCover(event.target.files?.[0]); event.currentTarget.value = ""; }} />
    <input ref={chapterCoverInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp,.png,.jpg,.jpeg,.webp" hidden onChange={(event) => { void uploadChapterCover(event.target.files?.[0]); event.currentTarget.value = ""; }} />
    <section className="chapter-hero">
      <div><span>{comic.format === "vertical" ? uiCopy.comic.format.vertical : comic.format === "four_panel" ? uiCopy.comic.format.fourPanel : uiCopy.comic.format.page} · {comic.chapters.length ? creationStatusLabel(comic.status) : uiCopy.comic.overview.chapter.waiting}</span><h1>{comic.title}</h1><p>{comic.summary}</p></div>
      <button type="button" className="chapter-cover-action" onClick={() => comicCoverInputRef.current?.click()}>{comic.coverUrl ? <img src={comic.coverUrl} alt={uiCopy.library.cover.comicAlt(comic.title)} /> : <div className="chapter-cover-placeholder"><b>{comic.title.slice(0, 2)}</b><span>{uploadingCover ? uiCopy.common.progress.uploadingPlain : uiCopy.comic.overview.cover.uploadHint}</span></div>}</button>
    </section>
    <section className="chapter-list app-page-wide">
      <div className="chapter-list-head"><h2>{uiCopy.comic.overview.section.chapters}</h2></div>
      {error ? <p className="chapter-list-error">{error}</p> : null}
      {comic.chapters.length ? comic.chapters.map((chapter) => <article className="chapter-list-card" key={chapter.id}>
        <button type="button" className="chapter-list-open" onClick={() => navigate(`/comics/${comic.id}/chapters/${chapter.id}${chapter.status === "completed" ? "/preview" : ""}`)}>
          {chapter.coverUrl ? <img src={chapter.coverUrl} alt={uiCopy.comic.overview.cover.chapterAlt(chapter.number)} loading="lazy" decoding="async"/> : <div className="chapter-thumb-placeholder"><span>{chapter.number}</span></div>}
          <span><small>{uiCopy.comic.overview.chapter.numberLabel(chapter.number)}</small><strong>{chapter.title}</strong><em><b className={`chapter-status ${chapter.status}`}>{creationStatusLabel(chapter.status)}</b>{chapter.summary}</em></span>
        </button>
        <div className="chapter-more-wrap" ref={chapterMenuId === chapter.id ? chapterMenuRef : null}>
          <button type="button" className="chapter-more-button" aria-label={uiCopy.comic.overview.chapter.moreAria(chapter.number)} onClick={() => { setChapterMenuId((current) => current === chapter.id ? null : chapter.id); setMenuOpen(false); }}><Icon name="more" /></button>
          {chapterMenuId === chapter.id ? <div className={`chapter-more-menu ${chapterMenuOpensUpward ? "opens-upward" : ""}`} role="menu">
            <button type="button" onClick={() => navigate(`/comics/${comic.id}/chapters/${chapter.id}`)}><Icon name="workbench" variant="compact" /><span>{uiCopy.common.action.enterWorkbench}</span></button>
            <button type="button" onClick={() => navigate(`/comics/${comic.id}/chapters/${chapter.id}/preview`)}><Icon name="preview" /><span>{uiCopy.comic.action.readingPreview}</span></button>
            <button type="button" onClick={() => { setChapterSettingsId(chapter.id); setChapterSettingsDraft({ title: chapter.title, summary: chapter.summary, status: chapter.status }); }}><Icon name="comicSettings" /><span>{uiCopy.comic.overview.section.chapterSettings}</span></button>
            <button type="button" className="chapter-delete-action" disabled={deletingChapterId === chapter.id} onClick={() => setConfirmDelete({ type: "chapter", chapter })}><Icon name="delete" /><span>{deletingChapterId === chapter.id ? uiCopy.common.progress.deletingPlain : uiCopy.comic.overview.action.deleteChapter}</span></button>
          </div> : null}
        </div>
      </article>) : null}
    </section>
    {settingsOpen ? <AppDialogPortal><div className="creation-dialog-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}><section className="creation-dialog" role="dialog" aria-modal="true" aria-labelledby="comic-settings-title" onMouseDown={(event) => event.stopPropagation()}><div><small>{uiCopy.comic.eyebrow.settings}</small><h2 id="comic-settings-title">{uiCopy.comic.overview.action.openSettings}</h2></div><label>{uiCopy.comic.field.name}<input autoFocus value={settingsDraft.title} onChange={(event) => setSettingsDraft((current) => ({ ...current, title: event.target.value }))}/></label><label>{uiCopy.comic.field.description}<textarea value={settingsDraft.summary} onChange={(event) => setSettingsDraft((current) => ({ ...current, summary: event.target.value }))}/></label><div className="comic-settings-options"><label>{uiCopy.comic.overview.field.creationStage}<CustomSelect ariaLabel={comic.isExample ? uiCopy.comic.overview.aria.exampleStatus : uiCopy.comic.overview.aria.status} className="creation-select" value={settingsDraft.status} options={creationStatusOptions} disabled={comic.isExample} onChange={(value) => setSettingsDraft((current) => ({ ...current, status: value as "in_progress" | "completed" }))} /></label>{comic.format === "page" ? <label>{uiCopy.comic.overview.field.readingOrder}<CustomSelect ariaLabel={uiCopy.comic.overview.field.readingOrder} className="creation-select" value={settingsDraft.defaultReadingDirection} options={readingDirectionOptions} onChange={(value) => setSettingsDraft((current) => ({ ...current, defaultReadingDirection: value as "ltr" | "rtl" }))} /></label> : null}</div><footer><button type="button" onClick={() => setSettingsOpen(false)}>{uiCopy.common.action.cancel}</button><button type="button" className="primary" disabled={!settingsDraft.title.trim() || !settingsDraft.summary.trim() || savingSettings} onClick={() => void saveSettings()}>{savingSettings ? uiCopy.common.progress.savingPlain : uiCopy.comic.overview.action.saveSettings}</button></footer></section></div></AppDialogPortal> : null}
    {chapterSettingsId ? <AppDialogPortal><div className="creation-dialog-backdrop" role="presentation" onMouseDown={() => setChapterSettingsId(null)}><section className="creation-dialog chapter-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="chapter-settings-title" onMouseDown={(event) => event.stopPropagation()}><div className="chapter-settings-heading"><small>{uiCopy.comic.eyebrow.chapterSettings}</small><h2 id="chapter-settings-title">{uiCopy.comic.overview.section.chapterSettings}</h2></div><div className="chapter-settings-layout"><div className="chapter-settings-fields"><label>{uiCopy.common.field.title}<input autoFocus value={chapterSettingsDraft.title} onChange={(event) => setChapterSettingsDraft((current) => ({ ...current, title: event.target.value }))}/></label><label>{uiCopy.comic.overview.field.chapterSummary}<textarea value={chapterSettingsDraft.summary} onChange={(event) => setChapterSettingsDraft((current) => ({ ...current, summary: event.target.value }))}/></label><label>{uiCopy.comic.overview.field.creationStage}<CustomSelect ariaLabel={uiCopy.comic.overview.aria.chapterStatus} className="creation-select" value={chapterSettingsDraft.status} options={creationStatusOptions} onChange={(value) => setChapterSettingsDraft((current) => ({ ...current, status: value as "in_progress" | "completed" }))} /></label></div><button type="button" className="chapter-settings-cover-card" aria-label={uiCopy.comic.overview.action.changeChapterCoverAria} onClick={() => { setPendingChapterCoverId(chapterSettingsId); chapterCoverInputRef.current?.click(); }}>{chapterSettingsChapter?.coverUrl ? <img src={chapterSettingsChapter.coverUrl} alt={uiCopy.comic.overview.cover.chapterAlt(chapterSettingsChapter.number)} /> : <span><b>{chapterSettingsChapter?.number ?? ""}</b><small>{uploadingCover ? uiCopy.common.progress.uploadingPlain : uiCopy.comic.overview.cover.changeHint}</small></span>}{chapterSettingsChapter?.coverUrl ? <em>{uploadingCover ? uiCopy.common.progress.uploadingPlain : uiCopy.comic.overview.cover.changeHint}</em> : null}</button></div><footer><button type="button" onClick={() => setChapterSettingsId(null)}>{uiCopy.common.action.cancel}</button><button type="button" className="primary" disabled={!chapterSettingsDraft.title.trim() || !chapterSettingsDraft.summary.trim() || savingChapterSettings} onClick={() => void saveChapterSettings()}>{savingChapterSettings ? uiCopy.common.progress.savingPlain : uiCopy.comic.overview.action.saveSettings}</button></footer></section></div></AppDialogPortal> : null}
    {creating ? <AppDialogPortal><div className="creation-dialog-backdrop" role="presentation" onMouseDown={() => setCreating(false)}><section className="creation-dialog" role="dialog" aria-modal="true" aria-labelledby="new-chapter-title" onMouseDown={(event) => event.stopPropagation()}><div><small>{uiCopy.comic.eyebrow.newChapter}</small><h2 id="new-chapter-title">{uiCopy.comic.overview.action.newChapter}</h2></div><label>{uiCopy.common.field.title}<input autoFocus value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}/></label><label>{uiCopy.comic.overview.field.chapterSummary}<textarea value={draft.summary} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))}/></label>{error ? <p className="creation-error">{error}</p> : null}<footer><button type="button" onClick={() => setCreating(false)}>{uiCopy.common.action.cancel}</button><button type="button" className="primary" disabled={!draft.title.trim() || submitting} onClick={() => void createChapter()}>{submitting ? uiCopy.common.progress.creating : uiCopy.comic.overview.action.createChapter}</button></footer></section></div></AppDialogPortal> : null}
    {confirmDelete ? <DeleteConfirmDialog dialogId={confirmDelete.type === "comic" ? "comic-delete" : "chapter-delete"} title={confirmDelete.type === "comic" ? uiCopy.comic.overview.deletion.comicTitle(comic.title) : uiCopy.comic.overview.deletion.chapterTitle(confirmDelete.chapter.number, confirmDelete.chapter.title)} description={confirmDelete.type === "comic" ? uiCopy.comic.overview.deletion.comicDescription : uiCopy.comic.overview.deletion.chapterDescription} confirmLabel={deletingComic || deletingChapterId ? uiCopy.common.progress.processing : uiCopy.common.action.confirmDelete} disabled={deletingComic || Boolean(deletingChapterId)} onCancel={() => setConfirmDelete(null)} onConfirm={() => confirmDelete.type === "comic" ? removeComic() : removeChapter(confirmDelete.chapter)} /> : null}
    <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">{toast}</div>
  </>;
}
