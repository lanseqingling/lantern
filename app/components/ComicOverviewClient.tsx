"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
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
import { Icon } from "@/packages/ui/src";
import { CustomSelect } from "./CustomSelect";

const canvasPageModeOptions = [
  { value: "single", label: "单页" },
  { value: "spread", label: "双页" },
];

export function ComicOverviewClient({ comicId }: { comicId: string }) {
  const router = useRouter();
  const comicCoverInputRef = useRef<HTMLInputElement>(null);
  const chapterCoverInputRef = useRef<HTMLInputElement>(null);
  const [comic, setComic] = useState<ComicListItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingComic, setDeletingComic] = useState(false);
  const [duplicatingComic, setDuplicatingComic] = useState(false);
  const [deletingChapterId, setDeletingChapterId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chapterMenuId, setChapterMenuId] = useState<string | null>(null);
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
  const [settingsDraft, setSettingsDraft] = useState<{ title: string; summary: string; worldSummary: string; canvasPageMode: "single" | "spread" }>({ title: "", summary: "", worldSummary: "", canvasPageMode: "single" });
  const [chapterSettingsDraft, setChapterSettingsDraft] = useState({ title: "", summary: "" });

  const reloadComic = async () => {
    setComic(await apiGetComic(comicId));
  };

  useEffect(() => {
    let alive = true;
    void apiGetComic(comicId)
      .then((next) => {
        if (alive) {
          setComic(next);
          if (next) setSettingsDraft({ title: next.title, summary: next.summary, worldSummary: next.worldSummary, canvasPageMode: next.canvasPageMode });
        }
      })
      .catch(() => {
        if (alive) setError("漫画信息暂时无法加载");
      });
    return () => { alive = false; };
  }, [comicId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const notify = (message: string) => setToast(message);
  const uploadErrorMessage = (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : "";
    if (/50MB/.test(message)) return "图片太大，请换一张小图。";
    if (/PNG|JPEG|WebP|请选择/.test(message)) return "请选择 PNG、JPEG 或 WebP。";
    return "上传失败，请换一张图片再试。";
  };
  const deleteErrorMessage = (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : "";
    if (/任务|task/i.test(message)) return "请先停止运行中的任务。";
    if (/服务|不可用|fetch|network|failed/i.test(message)) return "本地服务暂时不可用。";
    return "删除失败，请稍后再试。";
  };

  const createChapter = async () => {
    if (!draft.title.trim() || !draft.summary.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const created = await apiCreateChapter(comicId, { title: draft.title.trim(), summary: draft.summary.trim() });
      router.push(`/comics/${comicId}/chapters/${created.chapterId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建新一话失败");
      setSubmitting(false);
    }
  };

  const saveSettings = async () => {
    if (!comic || !settingsDraft.title.trim() || !settingsDraft.summary.trim() || savingSettings) return;
    setSavingSettings(true);
    setError("");
    try {
      const updated = await apiUpdateComic(comic.id, { title: settingsDraft.title.trim(), summary: settingsDraft.summary.trim(), worldSummary: settingsDraft.worldSummary.trim(), canvasPageMode: settingsDraft.canvasPageMode });
      setComic((current) => current ? { ...current, title: updated.title, summary: updated.summary, worldSummary: updated.worldSummary, canvasPageMode: updated.canvasPageMode.toLowerCase() as "single" | "spread" } : current);
      setSettingsOpen(false);
      setMenuOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存漫画设置失败");
    } finally {
      setSavingSettings(false);
    }
  };

  const saveChapterSettings = async () => {
    if (!comic || !chapterSettingsId || !chapterSettingsDraft.title.trim() || !chapterSettingsDraft.summary.trim() || savingChapterSettings) return;
    setSavingChapterSettings(true);
    setError("");
    try {
      const updated = await apiUpdateChapter(comic.id, chapterSettingsId, { title: chapterSettingsDraft.title.trim(), summary: chapterSettingsDraft.summary.trim() });
      setComic((current) => current ? { ...current, chapters: current.chapters.map((chapter) => chapter.id === chapterSettingsId ? { ...chapter, title: updated.title, summary: updated.summary } : chapter) } : current);
      setChapterSettingsId(null);
      setChapterMenuId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存章节设置失败");
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
      notify("已删除这一话。");
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
      notify("已删除漫画。");
      router.push("/workspace");
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
      notify("已复制为一部全新的漫画。");
      setMenuOpen(false);
      router.push(`/comics/${copied.comicId}`);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "复制漫画失败，请稍后再试。");
    } finally {
      setDuplicatingComic(false);
    }
  };

  if (!comic) return <section className="chapter-loading">{error || "正在加载漫画…"}</section>;
  const chapterSettingsChapter = chapterSettingsId ? comic.chapters.find((chapter) => chapter.id === chapterSettingsId) : null;

  return <>
    <header>
      <div className="chapter-top-left">
        <Link href="/workspace" className="chapter-back-icon" aria-label="返回我的漫画"><Icon name="collapse" /></Link>
        <div className="comic-settings-wrap">
          <button type="button" className="comic-settings-trigger" aria-label="漫画设置" onClick={() => setMenuOpen((open) => !open)}><span className="settings-mark comic-settings-mark" aria-hidden="true" /></button>
          {menuOpen ? <div className="comic-settings-menu" role="menu">
            <button type="button" onClick={() => { setSettingsDraft({ title: comic.title, summary: comic.summary, worldSummary: comic.worldSummary, canvasPageMode: comic.canvasPageMode }); setSettingsOpen(true); }}><span className="menu-item-glyph menu-item-glyph-settings" aria-hidden="true" /><span>漫画设置</span></button>
            <button type="button" onClick={() => router.push(`/comics/${comic.id}/assets`)}><Icon name="asset" /><span>资产空间</span></button>
            <button type="button" disabled={duplicatingComic} onClick={() => void duplicateComic()}><Icon name="copy" /><span>{duplicatingComic ? "复制中" : "复制漫画"}</span></button>
            <button type="button" disabled><Icon name="publish" /><span>发布漫画</span></button>
            <button type="button" disabled={deletingComic} onClick={() => setConfirmDelete({ type: "comic" })}><Icon name="trash" /><span>{deletingComic ? "删除中" : "删除漫画"}</span></button>
          </div> : null}
        </div>
      </div>
      <div className="chapter-top-right">
        <span className="library-brand"><span className="lantern-logo"><i /></span><strong>Lantern AI</strong></span>
        <div className="global-header-actions" aria-label="全局入口">
          <button type="button" className="global-icon-button" aria-label="用户页"><Icon name="user" /></button>
          <button type="button" className="global-icon-button" aria-label="全局设置"><Icon name="settings" /></button>
        </div>
      </div>
    </header>
    <input ref={comicCoverInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp,.png,.jpg,.jpeg,.webp" hidden onChange={(event) => { void uploadComicCover(event.target.files?.[0]); event.currentTarget.value = ""; }} />
    <input ref={chapterCoverInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp,.png,.jpg,.jpeg,.webp" hidden onChange={(event) => { void uploadChapterCover(event.target.files?.[0]); event.currentTarget.value = ""; }} />
    <section className="chapter-hero">
      <div><span>{comic.format === "vertical" ? "条漫" : comic.format === "four_panel" ? "四格" : "页漫"} · {comic.chapters.length ? "创作中" : "等待第一话"}</span><h1>{comic.title}</h1><p>{comic.summary}</p></div>
      <button type="button" className="chapter-cover-action" onClick={() => comicCoverInputRef.current?.click()}>{comic.coverUrl ? <img src={comic.coverUrl} alt={`${comic.title}漫画封面`} /> : <div className="chapter-cover-placeholder"><b>{comic.title.slice(0, 2)}</b><span>{uploadingCover ? "上传中" : "点击上传封面"}</span></div>}</button>
    </section>
    <section className="chapter-list">
      <div className="chapter-list-head"><h2>章节</h2><button type="button" className="chapter-add-button" aria-label="新建一话" onClick={() => { setDraft({ title: `第 ${comic.chapters.length + 1} 话`, summary: "" }); setCreating(true); }}><span aria-hidden="true" /></button></div>
      {error ? <p className="chapter-list-error">{error}</p> : null}
      {comic.chapters.length ? comic.chapters.map((chapter) => <article className="chapter-list-card" key={chapter.id}>
        <button type="button" className="chapter-list-open" onClick={() => router.push(`/comics/${comic.id}/chapters/${chapter.id}`)}>
          {chapter.coverUrl ? <img src={chapter.coverUrl} alt={`第 ${chapter.number} 话封面`} loading="lazy" decoding="async"/> : <div className="chapter-thumb-placeholder"><span>{chapter.number}</span></div>}
          <span><small>第 {chapter.number} 话</small><strong>{chapter.title}</strong><em>{chapter.summary}</em></span>
        </button>
        <div className="chapter-more-wrap">
          <button type="button" className="chapter-more-button" aria-label={`第 ${chapter.number} 话更多选项`} onClick={() => setChapterMenuId((current) => current === chapter.id ? null : chapter.id)}><Icon name="more" /></button>
          {chapterMenuId === chapter.id ? <div className="chapter-more-menu" role="menu">
            <button type="button" onClick={() => { setChapterSettingsId(chapter.id); setChapterSettingsDraft({ title: chapter.title, summary: chapter.summary }); }}><span className="menu-item-glyph menu-item-glyph-settings" aria-hidden="true" /><span>修改设置</span></button>
            <button type="button" disabled={deletingChapterId === chapter.id} onClick={() => setConfirmDelete({ type: "chapter", chapter })}><Icon name="trash" /><span>{deletingChapterId === chapter.id ? "删除中" : "删除一话"}</span></button>
          </div> : null}
        </div>
      </article>) : <div className="chapter-empty"><svg className="chapter-empty-border" aria-hidden="true"><rect /></svg><button type="button" className="chapter-empty-add-button" aria-label="新建第一话" onClick={() => { setDraft({ title: "第 1 话", summary: "" }); setCreating(true); }}><span aria-hidden="true" /></button><strong>还没有章节</strong><p>开启第一话，和 Agent 共同完成漫画创作。</p></div>}
    </section>
    {settingsOpen ? <div className="creation-dialog-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}><section className="creation-dialog" role="dialog" aria-modal="true" aria-labelledby="comic-settings-title" onMouseDown={(event) => event.stopPropagation()}><div><small>COMIC SETTINGS</small><h2 id="comic-settings-title">漫画设置</h2></div><label>漫画名称<input autoFocus value={settingsDraft.title} onChange={(event) => setSettingsDraft((current) => ({ ...current, title: event.target.value }))}/></label><label>漫画简介<textarea value={settingsDraft.summary} onChange={(event) => setSettingsDraft((current) => ({ ...current, summary: event.target.value }))}/></label><label>画布页面模式<CustomSelect ariaLabel="画布页面模式" value={settingsDraft.canvasPageMode} options={canvasPageModeOptions} onChange={(value) => setSettingsDraft((current) => ({ ...current, canvasPageMode: value as "single" | "spread" }))}/></label><label>世界观背景<textarea value={settingsDraft.worldSummary} placeholder="世界规则、时代背景、超自然机制或长期冲突；会自动进入 Agent 上下文。" onChange={(event) => setSettingsDraft((current) => ({ ...current, worldSummary: event.target.value }))}/></label><footer><button type="button" onClick={() => setSettingsOpen(false)}>取消</button><button type="button" className="primary" disabled={!settingsDraft.title.trim() || !settingsDraft.summary.trim() || savingSettings} onClick={() => void saveSettings()}>{savingSettings ? "保存中" : "保存设置"}</button></footer></section></div> : null}
    {chapterSettingsId ? <div className="creation-dialog-backdrop" role="presentation" onMouseDown={() => setChapterSettingsId(null)}><section className="creation-dialog chapter-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="chapter-settings-title" onMouseDown={(event) => event.stopPropagation()}><div className="chapter-settings-heading"><small>CHAPTER SETTINGS</small><h2 id="chapter-settings-title">修改设置</h2></div><div className="chapter-settings-layout"><div className="chapter-settings-fields"><label>标题<input autoFocus value={chapterSettingsDraft.title} onChange={(event) => setChapterSettingsDraft((current) => ({ ...current, title: event.target.value }))}/></label><label>本话梗概<textarea value={chapterSettingsDraft.summary} onChange={(event) => setChapterSettingsDraft((current) => ({ ...current, summary: event.target.value }))}/></label></div><button type="button" className="chapter-settings-cover-card" aria-label="更换本话封面" onClick={() => { setPendingChapterCoverId(chapterSettingsId); chapterCoverInputRef.current?.click(); }}>{chapterSettingsChapter?.coverUrl ? <img src={chapterSettingsChapter.coverUrl} alt={`第 ${chapterSettingsChapter.number} 话封面`} /> : <span><b>{chapterSettingsChapter?.number ?? ""}</b><small>{uploadingCover ? "上传中" : "点击更换封面"}</small></span>}{chapterSettingsChapter?.coverUrl ? <em>{uploadingCover ? "上传中" : "点击更换封面"}</em> : null}</button></div><footer><button type="button" onClick={() => setChapterSettingsId(null)}>取消</button><button type="button" className="primary" disabled={!chapterSettingsDraft.title.trim() || !chapterSettingsDraft.summary.trim() || savingChapterSettings} onClick={() => void saveChapterSettings()}>{savingChapterSettings ? "保存中" : "保存设置"}</button></footer></section></div> : null}
    {creating ? <div className="creation-dialog-backdrop" role="presentation" onMouseDown={() => setCreating(false)}><section className="creation-dialog" role="dialog" aria-modal="true" aria-labelledby="new-chapter-title" onMouseDown={(event) => event.stopPropagation()}><div><small>NEW CHAPTER</small><h2 id="new-chapter-title">新建一话</h2></div><label>标题<input autoFocus value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}/></label><label>本话梗概<textarea value={draft.summary} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))}/></label>{error ? <p className="creation-error">{error}</p> : null}<footer><button type="button" onClick={() => setCreating(false)}>取消</button><button type="button" className="primary" disabled={!draft.title.trim() || !draft.summary.trim() || submitting} onClick={() => void createChapter()}>{submitting ? "正在创建…" : "创建并进入工作区"}</button></footer></section></div> : null}
    {confirmDelete ? <div className="confirm-dialog-backdrop" role="presentation" onMouseDown={() => setConfirmDelete(null)}><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title" onMouseDown={(event) => event.stopPropagation()}><span><Icon name="trash" /></span><div><small>{confirmDelete.type === "comic" ? "DELETE COMIC" : "DELETE CHAPTER"}</small><h2 id="delete-confirm-title">{confirmDelete.type === "comic" ? `删除漫画「${comic.title}」？` : `删除「第 ${confirmDelete.chapter.number} 话 · ${confirmDelete.chapter.title}」？`}</h2><p>{confirmDelete.type === "comic" ? "它和所有章节会从列表中隐藏，之后不会再出现在当前创作空间。" : "这一话会从章节列表中隐藏，当前漫画的其他内容会保留。"}</p></div><footer><button type="button" onClick={() => setConfirmDelete(null)}>取消</button><button type="button" className="confirm-action" disabled={deletingComic || Boolean(deletingChapterId)} onClick={() => confirmDelete.type === "comic" ? void removeComic() : void removeChapter(confirmDelete.chapter)}>{deletingComic || deletingChapterId ? "处理中" : "确认删除"}</button></footer></section></div> : null}
    <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">{toast}</div>
  </>;
}
