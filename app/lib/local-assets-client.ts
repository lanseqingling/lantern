import { configuredRuntimeAdapter } from "./api-client";

export type LocalAssetSource = "upload" | "generated";

export type LocalAssetRecord = {
  id: string;
  fileName: string;
  originalName: string;
  contentType: string;
  source: LocalAssetSource;
  createdAt: string;
  url: string;
  storage: "local-fs" | "local-indexeddb";
};

function openLocalAssetDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("lantern-ai-local-assets", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function saveBrowserLocalAsset(file: File, source: LocalAssetSource): Promise<LocalAssetRecord> {
  const id = `asset-${Date.now()}-${crypto.randomUUID()}`;
  const db = await openLocalAssetDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put({ file, source, createdAt: new Date().toISOString() }, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return {
    id,
    fileName: file.name,
    originalName: file.name,
    contentType: file.type || "application/octet-stream",
    source,
    createdAt: new Date().toISOString(),
    url: URL.createObjectURL(file),
    storage: "local-indexeddb",
  };
}

async function saveLocalAsset(file: File, source: LocalAssetSource): Promise<LocalAssetRecord> {
  if (configuredRuntimeAdapter() !== "demo") {
    throw new Error("LOCAL_ASSET_ADAPTER_IS_DEMO_ONLY");
  }
  const form = new FormData();
  form.set("file", file);
  form.set("source", source);
  try {
    const response = await fetch("/api/local-assets", { method: "POST", body: form });
    if (response.ok) {
      const record = await response.json() as LocalAssetRecord;
      return { ...record, storage: "local-fs" };
    }
  } catch {
    // Explicit demo mode can fall back to browser-local storage.
  }
  return saveBrowserLocalAsset(file, source);
}

export function saveUploadedImage(file: File) {
  return saveLocalAsset(file, "upload");
}

export async function saveGeneratedImageFromUrl(src: string, name: string) {
  const response = await fetch(src);
  if (!response.ok) throw new Error("GENERATED_ASSET_FETCH_FAILED");
  const blob = await response.blob();
  const file = new File([blob], name, { type: blob.type || "image/png" });
  return saveLocalAsset(file, "generated");
}
