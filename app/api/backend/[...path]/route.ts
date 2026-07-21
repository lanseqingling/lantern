export const runtime = "nodejs";
import { getConfig } from "../../../../packages/server/src/config";

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const upstreamBase = (process.env.LANTERN_API_INTERNAL_URL || "http://127.0.0.1:18787").replace(/\/$/, "");
  const incomingUrl = new URL(request.url);
  const upstreamUrl = `${upstreamBase}/${path.map(encodeURIComponent).join("/")}${incomingUrl.search}`;
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("authorization", `Bearer ${getConfig().LANTERN_LOCAL_TOKEN}`);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  // Buffer multipart payloads before proxying. Vinext's route adapter can hand
  // over a stream that is no longer readable by the Node fetch implementation,
  // which made image uploads fail although JSON requests kept working.
  const body = hasBody ? await request.arrayBuffer() : undefined;
  const init: RequestInit = {
    method: request.method,
    headers,
    body,
    redirect: "manual",
  };
  let response: Response;
  try {
    response = await fetch(upstreamUrl, init);
  } catch {
    return Response.json(
      { error: { code: "upstream_unavailable", message: "本地服务暂时不可用。" }, requestId: crypto.randomUUID() },
      { status: 503 },
    );
  }
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-length");
  responseHeaders.delete("content-encoding");
  return new Response(response.body, { status: response.status, headers: responseHeaders });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
