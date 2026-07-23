"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@lantern/ui";
import { navigateWithContentTransition, useContentRouteEntryTransition, useDelayedLoadingIndicator } from "@/app/lib/content-route-transition";
import { CustomSelect } from "./CustomSelect";
import {
  apiGetGlobalSettings,
  apiUpdateGlobalSettings,
  type GlobalSettings,
  type ModelCapability,
} from "@/app/lib/api-client";

type ModelDraft = GlobalSettings["models"][number] & { apiKey: string };

function safeReturnTo(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/workspace";
}

function capabilityIcon(capability: ModelCapability) {
  return capability === "text" ? "message" : capability === "image" ? "ai" : "scan";
}

function providerLabel(draft: ModelDraft) {
  return draft.providerOptions.find((provider) => provider.id === draft.providerId)?.label ?? draft.providerId;
}

function secretMask(draft: ModelDraft) {
  return draft.keyConfigured
    ? <span className="settings-secret-mask" aria-label="API Key 已配置">••••••••••••</span>
    : <span className="settings-secret-empty">未配置</span>;
}

export function SettingsClient() {
  const router = useRouter();
  const entryTransition = useContentRouteEntryTransition();
  const searchParams = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get("returnTo"));
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [drafts, setDrafts] = useState<ModelDraft[]>([]);
  const [expanded, setExpanded] = useState<Set<ModelCapability>>(() => new Set());
  const [editing, setEditing] = useState<Set<ModelCapability>>(() => new Set());
  const [saving, setSaving] = useState<Set<ModelCapability>>(() => new Set());
  const [notices, setNotices] = useState<Partial<Record<ModelCapability, string>>>({});
  const [loadingError, setLoadingError] = useState("");
  const showInitialLoading = useDelayedLoadingIndicator(!settings && !loadingError);

  useEffect(() => {
    void apiGetGlobalSettings()
      .then((value) => {
        setSettings(value);
        setDrafts(value.models.map((model) => ({ ...model, apiKey: "" })));
      })
      .catch((error) => setLoadingError(error instanceof Error ? error.message : "设置载入失败"));
  }, []);

  const updateDraft = (capability: ModelCapability, patch: Partial<ModelDraft>) => {
    setDrafts((current) => current.map((draft) => draft.capability === capability ? { ...draft, ...patch } : draft));
    setNotices((current) => ({ ...current, [capability]: "" }));
  };

  const selectProvider = (capability: ModelCapability, providerId: string) => {
    const provider = drafts.find((draft) => draft.capability === capability)?.providerOptions.find((item) => item.id === providerId);
    if (!provider) return;
    updateDraft(capability, { providerId, baseUrl: provider.defaultBaseUrl, model: provider.defaultModel });
  };

  const toggleExpanded = (capability: ModelCapability) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(capability)) next.delete(capability);
      else next.add(capability);
      return next;
    });
  };

  const beginEditing = (capability: ModelCapability) => {
    setExpanded((current) => new Set(current).add(capability));
    setEditing((current) => new Set(current).add(capability));
    setNotices((current) => ({ ...current, [capability]: "" }));
  };

  const cancelEditing = (capability: ModelCapability) => {
    const saved = settings?.models.find((model) => model.capability === capability);
    if (saved) setDrafts((current) => current.map((draft) => draft.capability === capability ? { ...saved, apiKey: "" } : draft));
    setEditing((current) => {
      const next = new Set(current);
      next.delete(capability);
      return next;
    });
    setNotices((current) => ({ ...current, [capability]: "" }));
  };

  const saveModel = async (capability: ModelCapability) => {
    const draft = drafts.find((item) => item.capability === capability);
    if (!draft) return;
    setSaving((current) => new Set(current).add(capability));
    setNotices((current) => ({ ...current, [capability]: "" }));
    try {
      const next = await apiUpdateGlobalSettings([{
        capability,
        providerId: draft.providerId,
        baseUrl: draft.baseUrl.trim(),
        model: draft.model.trim(),
        ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
      }]);
      const saved = next.models.find((model) => model.capability === capability);
      setSettings(next);
      if (saved) setDrafts((current) => current.map((item) => item.capability === capability ? { ...saved, apiKey: "" } : item));
      setEditing((current) => {
        const updated = new Set(current);
        updated.delete(capability);
        return updated;
      });
      setNotices((current) => ({ ...current, [capability]: "" }));
    } catch (error) {
      setNotices((current) => ({ ...current, [capability]: error instanceof Error ? error.message : "保存失败" }));
    } finally {
      setSaving((current) => {
        const nextSaving = new Set(current);
        nextSaving.delete(capability);
        return nextSaving;
      });
    }
  };

  return (
    <main className={`settings-page app-surface route-page-transition route-page-transition-fade ${entryTransition}`}>
      <header className="settings-header">
        <button type="button" className="settings-back app-page-corner-button" aria-label="返回" onClick={() => navigateWithContentTransition("back", () => router.push(returnTo))}><Icon name="collapse" /></button>
      </header>

      <section className="settings-shell app-page-narrow">
        <div className="settings-title app-page-title">
          <span><Icon name="settings" /></span>
          <div><small>GLOBAL SETTINGS</small><h1>全局设置</h1></div>
        </div>

        {loadingError ? <section className="settings-error"><strong>无法载入设置</strong><p>{loadingError}</p></section> : null}
        {!settings && !loadingError && showInitialLoading ? <div className="settings-loading">正在载入设置…</div> : null}

        {settings ? <>
          <section className="settings-section">
            <div className="settings-section-heading"><h2>模型 API</h2></div>
            <div className="settings-model-list">
              {drafts.map((draft) => {
                const isExpanded = expanded.has(draft.capability);
                const isEditing = editing.has(draft.capability);
                const isSaving = saving.has(draft.capability);
                return (
                  <article className={`settings-model-card ${isExpanded ? "expanded" : ""}`} key={draft.capability}>
                    <button type="button" className="settings-model-summary" aria-expanded={isExpanded} onClick={() => toggleExpanded(draft.capability)}>
                      <span className="settings-model-icon"><Icon name={capabilityIcon(draft.capability)} /></span>
                      <span className="settings-model-heading"><strong>{draft.label}</strong><small>{providerLabel(draft)} · {draft.model}</small></span>
                      {secretMask(draft)}
                      <span className="settings-model-chevron"><Icon name="chevronDown" /></span>
                    </button>

                    {isExpanded ? <div className="settings-model-details">
                      {isEditing ? <div className="settings-fields">
                        <label>
                          <span>提供方</span>
                          <CustomSelect
                            ariaLabel={`${draft.label}提供方`}
                            className="settings-provider-select"
                            value={draft.providerId}
                            options={draft.providerOptions.map((provider) => ({ value: provider.id, label: provider.label, disabled: draft.environmentOverride }))}
                            onChange={(value) => selectProvider(draft.capability, value)}
                          />
                        </label>
                        <label>
                          <span>模型</span>
                          <input value={draft.model} disabled={draft.environmentOverride} onChange={(event) => updateDraft(draft.capability, { model: event.target.value })} />
                        </label>
                        <label className="settings-field-wide">
                          <span>API 地址</span>
                          <input type="url" value={draft.baseUrl} disabled={draft.environmentOverride} onChange={(event) => updateDraft(draft.capability, { baseUrl: event.target.value })} />
                        </label>
                        <label className="settings-field-wide">
                          <span>API Key</span>
                          <input type="password" autoComplete="new-password" placeholder="输入 API Key" value={draft.apiKey} disabled={draft.environmentOverride} onChange={(event) => updateDraft(draft.capability, { apiKey: event.target.value })} />
                        </label>
                      </div> : <dl className="settings-model-values">
                        <div><dt>提供方</dt><dd>{providerLabel(draft)}</dd></div>
                        <div><dt>模型</dt><dd>{draft.model}</dd></div>
                        <div><dt>API 地址</dt><dd title={draft.baseUrl}>{draft.baseUrl}</dd></div>
                        <div><dt>API Key</dt><dd>{secretMask(draft)}</dd></div>
                      </dl>}

                      {draft.environmentOverride ? <p className="settings-managed-note">这项配置由启动环境变量管理。</p> : null}
                      <footer className="settings-model-actions">
                        <span>{notices[draft.capability]}</span>
                        {isEditing ? <div>
                          <button type="button" disabled={isSaving} onClick={() => cancelEditing(draft.capability)}>取消</button>
                          <button type="button" className="primary" disabled={isSaving || !draft.model.trim() || !draft.baseUrl.trim()} onClick={() => void saveModel(draft.capability)}><Icon name="save" />{isSaving ? "保存中…" : "保存"}</button>
                        </div> : <button type="button" disabled={draft.environmentOverride} onClick={() => beginEditing(draft.capability)}><Icon name="edit" />修改</button>}
                      </footer>
                    </div> : null}
                  </article>
                );
              })}
            </div>
          </section>

          <section className="settings-section settings-runtime">
            <div className="settings-section-heading"><h2>本地运行</h2></div>
            <dl>
              <div><dt>数据目录</dt><dd title={settings.runtime.dataDirectory}>{settings.runtime.dataDirectory}</dd></div>
              <div><dt>本地端口</dt><dd>Web {settings.runtime.webPort} · API {settings.runtime.apiPort}</dd></div>
              <div><dt>对象存储</dt><dd>{settings.runtime.objectStorage}</dd></div>
            </dl>
          </section>
        </> : null}
      </section>
    </main>
  );
}
