"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@lantern/ui";
import { navigateWithContentTransition, useContentRouteEntryTransition, useDelayedLoadingIndicator } from "@/app/lib/content-route-transition";
import { CustomSelect } from "./CustomSelect";
import { uiCopy } from "@/app/lib/ui-copy";
import {
  apiGetGlobalSettings,
  apiGetUpdateStatus,
  apiUpdateGlobalSettings,
  type GlobalSettings,
  type ModelCapability,
  type UpdateStatus,
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
    ? <span className="settings-secret-mask" aria-label={uiCopy.settings.apiKey.configuredAria}>••••••••••••</span>
    : <span className="settings-secret-empty">{uiCopy.common.status.notConfigured}</span>;
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
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const showInitialLoading = useDelayedLoadingIndicator(!settings && !loadingError);

  useEffect(() => {
    void apiGetGlobalSettings()
      .then((value) => {
        setSettings(value);
        setDrafts(value.models.map((model) => ({ ...model, apiKey: "" })));
      })
      .catch((error) => setLoadingError(error instanceof Error ? error.message : uiCopy.settings.error.loadFailed));
  }, []);

  const loadUpdateStatus = async (refresh = false) => {
    setCheckingUpdate(true);
    try { setUpdateStatus(await apiGetUpdateStatus(refresh)); }
    finally { setCheckingUpdate(false); }
  };

  useEffect(() => { void loadUpdateStatus(); }, []);

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
      setNotices((current) => ({ ...current, [capability]: error instanceof Error ? error.message : uiCopy.common.status.saveFailed }));
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
        <button type="button" className="settings-back app-page-corner-button" aria-label={uiCopy.common.action.back} onClick={() => navigateWithContentTransition("back", () => router.push(returnTo))}><Icon name="collapse" /></button>
      </header>

      <section className="settings-shell app-page-narrow">
        <div className="settings-title app-page-title">
          <span><Icon name="settings" /></span>
          <div><small>{uiCopy.eyebrow.globalSettings}</small><h1>{uiCopy.common.navigation.globalSettings}</h1></div>
        </div>

        {loadingError ? <section className="settings-error"><strong>{uiCopy.settings.error.heading}</strong><p>{loadingError}</p></section> : null}
        {!settings && !loadingError && showInitialLoading ? <div className="settings-loading">{uiCopy.settings.page.loading}</div> : null}

        {settings ? <>
          <section className="settings-section">
            <div className="settings-section-heading"><h2>{uiCopy.settings.section.modelApi}</h2></div>
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
                          <span>{uiCopy.settings.field.provider}</span>
                          <CustomSelect
                            ariaLabel={uiCopy.settings.field.providerAria(draft.label)}
                            className="settings-provider-select"
                            value={draft.providerId}
                            options={draft.providerOptions.map((provider) => ({ value: provider.id, label: provider.label, disabled: draft.environmentOverride }))}
                            onChange={(value) => selectProvider(draft.capability, value)}
                          />
                        </label>
                        <label>
                          <span>{uiCopy.settings.field.model}</span>
                          <input value={draft.model} disabled={draft.environmentOverride} onChange={(event) => updateDraft(draft.capability, { model: event.target.value })} />
                        </label>
                        <label className="settings-field-wide">
                          <span>{uiCopy.settings.field.apiUrl}</span>
                          <input type="url" value={draft.baseUrl} disabled={draft.environmentOverride} onChange={(event) => updateDraft(draft.capability, { baseUrl: event.target.value })} />
                        </label>
                        <label className="settings-field-wide">
                          <span>{uiCopy.settings.apiKey.label}</span>
                          <input type="password" autoComplete="new-password" placeholder={uiCopy.settings.apiKey.placeholder} value={draft.apiKey} disabled={draft.environmentOverride} onChange={(event) => updateDraft(draft.capability, { apiKey: event.target.value })} />
                        </label>
                      </div> : <dl className="settings-model-values">
                        <div><dt>{uiCopy.settings.field.provider}</dt><dd>{providerLabel(draft)}</dd></div>
                        <div><dt>{uiCopy.settings.field.model}</dt><dd>{draft.model}</dd></div>
                        <div><dt>{uiCopy.settings.field.apiUrl}</dt><dd title={draft.baseUrl}>{draft.baseUrl}</dd></div>
                        <div><dt>{uiCopy.settings.apiKey.label}</dt><dd>{secretMask(draft)}</dd></div>
                      </dl>}

                      {draft.environmentOverride ? <p className="settings-managed-note">{uiCopy.settings.apiKey.managedByEnvironment}</p> : null}
                      <footer className="settings-model-actions">
                        <span>{notices[draft.capability]}</span>
                        {isEditing ? <div>
                          <button type="button" disabled={isSaving} onClick={() => cancelEditing(draft.capability)}>{uiCopy.common.action.cancel}</button>
                          <button type="button" className="primary" disabled={isSaving || !draft.model.trim() || !draft.baseUrl.trim()} onClick={() => void saveModel(draft.capability)}><Icon name="save" />{isSaving ? uiCopy.common.progress.saving : uiCopy.common.action.save}</button>
                        </div> : <button type="button" disabled={draft.environmentOverride} onClick={() => beginEditing(draft.capability)}><Icon name="edit" />{uiCopy.common.action.edit}</button>}
                      </footer>
                    </div> : null}
                  </article>
                );
              })}
            </div>
          </section>

          <section className="settings-section settings-runtime">
            <div className="settings-section-heading"><h2>{uiCopy.settings.section.localRuntime}</h2></div>
            <dl>
              <div><dt>{uiCopy.settings.runtime.dataDirectory}</dt><dd title={settings.runtime.dataDirectory}>{settings.runtime.dataDirectory}</dd></div>
              <div><dt>{uiCopy.settings.runtime.localPorts}</dt><dd>Web {settings.runtime.webPort} · API {settings.runtime.apiPort}</dd></div>
              <div><dt>{uiCopy.settings.runtime.objectStorage}</dt><dd>{settings.runtime.objectStorage}</dd></div>
            </dl>
          </section>
          <section className="settings-section settings-update">
            <div className="settings-section-heading"><h2>{uiCopy.settings.section.updates}</h2><button type="button" aria-label={uiCopy.settings.update.checkAria} disabled={checkingUpdate} onClick={() => void loadUpdateStatus(true)}><Icon name="replace" />{uiCopy.settings.update.check}</button></div>
            <dl><div><dt>{uiCopy.settings.update.currentLabel}</dt><dd className={`settings-update-version ${updateStatus?.state === "available" ? "available" : ""}`}>{updateStatus?.state === "available" && updateStatus.latestVersion && updateStatus.releaseUrl ? <a href={updateStatus.releaseUrl} target="_blank" rel="noreferrer" aria-label={uiCopy.settings.update.download}>{uiCopy.settings.update.available(updateStatus.currentVersion, updateStatus.latestVersion)}<Icon name="download" /></a> : updateStatus?.state === "available" && updateStatus.latestVersion ? uiCopy.settings.update.available(updateStatus.currentVersion, updateStatus.latestVersion) : updateStatus?.currentVersion ? `v${updateStatus.currentVersion}` : uiCopy.settings.update.checking}</dd></div></dl>
          </section>
        </> : null}
      </section>
    </main>
  );
}
