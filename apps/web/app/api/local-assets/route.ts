import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getRuntimePaths } from "@lantern/server/runtime-paths";

export const runtime = "nodejs";

const localAssetRoot = process.env.LANTERN_LOCAL_ASSET_DIR
  ?? path.join(getRuntimePaths().dataDir, "demo", "objects");
const mimeToExt = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/svg+xml", ".svg"],
]);

type LocalAssetMeta = {
  id: string;
  fileName: string;
  originalName: string;
  contentType: string;
  source: string;
  createdAt: string;
};

function safeExt(file: File) {
  const fromMime = mimeToExt.get(file.type);
  if (fromMime) return fromMime;
  const fromName = path.extname(file.name).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".svg"].includes(fromName) ? fromName : ".bin";
}

function assertSafeId(id: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) throw new Error("invalid local asset id");
}

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_LANTERN_RUNTIME_ADAPTER !== "demo") {
    return Response.json({ error: "local assets are available only in demo mode" }, { status: 404 });
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file is required" }, { status: 400 });

  const source = String(form.get("source") ?? "upload");
  const id = `asset-${Date.now()}-${randomUUID()}`;
  const fileName = `${id}${safeExt(file)}`;
  const contentType = file.type || "application/octet-stream";
  const meta: LocalAssetMeta = { id, fileName, originalName: file.name, contentType, source, createdAt: new Date().toISOString() };

  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    await mkdir(localAssetRoot, { recursive: true });
    await writeFile(path.join(localAssetRoot, fileName), bytes);
    await writeFile(path.join(localAssetRoot, `${id}.json`), JSON.stringify(meta, null, 2));
  } catch (error) {
    console.error("Failed to save local Lantern asset", error);
    return Response.json({ error: "local asset save failed" }, { status: 500 });
  }

  return Response.json({
    ...meta,
    url: `/api/local-assets?id=${encodeURIComponent(id)}`,
    storage: "local-fs",
  });
}

export async function GET(request: Request) {
  if (process.env.NEXT_PUBLIC_LANTERN_RUNTIME_ADAPTER !== "demo") {
    return Response.json({ error: "local assets are available only in demo mode" }, { status: 404 });
  }
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  try {
    assertSafeId(id);
    const meta = JSON.parse(await readFile(path.join(localAssetRoot, `${id}.json`), "utf8")) as LocalAssetMeta;
    const bytes = await readFile(path.join(localAssetRoot, meta.fileName));
    return new Response(bytes, {
      headers: {
        "Content-Type": meta.contentType,
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return Response.json({ error: "local asset not found" }, { status: 404 });
  }
}
