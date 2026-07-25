import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { createApiApp } from "../apps/api/src/app";
import { getConfig } from "@lantern/server/config";
import { initializeDatabaseConnection, prisma } from "@lantern/server/db";
import { createComicLibraryAsset } from "@lantern/server/asset-library-service";
import { prepareExternalAssetUpload } from "@lantern/server/external-upload-service";
import {
  LOCAL_USER_DISPLAY_NAME,
  LOCAL_USER_EMAIL,
  LOCAL_USER_ID,
} from "@lantern/server/local-runtime";

let app: FastifyInstance;
let authorization: string;
let mcpAuthorization: string;

before(async () => {
  await initializeDatabaseConnection();
  await prisma.user.upsert({
    where: { id: LOCAL_USER_ID },
    create: {
      id: LOCAL_USER_ID,
      email: LOCAL_USER_EMAIL,
      displayName: LOCAL_USER_DISPLAY_NAME,
    },
    update: {},
  });
  authorization = `Bearer ${getConfig().LANTERN_LOCAL_TOKEN}`;
  mcpAuthorization = `Bearer ${getConfig().LANTERN_MCP_TOKEN}`;
  app = await createApiApp({ logger: false });
  await app.ready();
});

after(async () => {
  await app.close();
  await prisma.$disconnect();
});

test("API factory registers the public health contract without starting a listener", async () => {
  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.data.status, "ok");
  assert.equal(body.data.database, "ok");
  assert.equal(body.data.taskRunner.state, "stopped");
  assert.equal(typeof body.requestId, "string");
});

test("protected API routes reject requests without the installation token", async () => {
  const response = await app.inject({ method: "GET", url: "/v1/auth/me" });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "unauthorized");
});

test("protected API routes resolve the stable local user", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/v1/auth/me",
    headers: { authorization },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.data.id, LOCAL_USER_ID);
  assert.equal(body.data.email, LOCAL_USER_EMAIL);
});

test("global settings expose provider choices without returning API keys", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/v1/settings",
    headers: { authorization },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.deepEqual(body.data.models.map((model: { capability: string }) => model.capability), ["text", "image", "vision"]);
  assert.equal(body.data.models[0].providerOptions[0].id, "deepseek");
  assert.equal("apiKey" in body.data.models[0], false);
  assert.equal(JSON.stringify(body).includes("LANTERN_LOCAL_TOKEN"), false);
});

test("MCP uses an independent loopback credential and rejects browser origins", async () => {
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "lantern-test", version: "1.0.0" },
    },
  };
  const localToken = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: { authorization, accept: "application/json, text/event-stream" },
    payload,
  });
  assert.equal(localToken.statusCode, 401);

  const browserOrigin = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: { authorization: mcpAuthorization, origin: "http://localhost:18788", accept: "application/json, text/event-stream" },
    payload,
  });
  assert.equal(browserOrigin.statusCode, 403);
  assert.equal(browserOrigin.json().error.code, "mcp_origin_forbidden");

  const initialized = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: { authorization: mcpAuthorization, accept: "application/json, text/event-stream" },
    payload,
  });
  assert.equal(initialized.statusCode, 200);
  assert.match(initialized.body, /"name":"lantern"/);
  assert.match(initialized.body, /lantern:\/\//);

  const tools = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: { authorization: mcpAuthorization, accept: "application/json, text/event-stream" },
    payload: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  });
  assert.equal(tools.statusCode, 200);
  for (const name of ["lantern_projects_list", "lantern_context_get", "lantern_composition_inspect", "lantern_capabilities_list", "lantern_images_inspect", "lantern_comic_get", "lantern_comic_update", "lantern_chapter_create", "lantern_asset_create", "lantern_asset_variant_create", "lantern_asset_image_upload_prepare", "lantern_asset_image_attach", "lantern_asset_image_set_primary"]) {
    assert.match(tools.body, new RegExp(`"name":"${name}"`));
  }
  assert.match(tools.body, /"readOnlyHint":true/);

  const capabilities = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: { authorization: mcpAuthorization, accept: "application/json, text/event-stream" },
    payload: {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "lantern_capabilities_list", arguments: {} },
    },
  });
  assert.equal(capabilities.statusCode, 200);
  assert.match(capabilities.body, /context\.inspect_images/);
  assert.match(capabilities.body, /context\.inspect_composition/);
  assert.match(capabilities.body, /comic\.update/);
  assert.match(capabilities.body, /asset\.create/);
  assert.doesNotMatch(capabilities.body, /storyboard\.edit_single_entry/);
});

test("registered domain routes preserve validation and response envelopes", async () => {
  const invalid = await app.inject({
    method: "POST",
    url: "/v1/comics",
    headers: { authorization, "content-type": "application/json" },
    payload: { title: "", summary: "" },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, "validation");

  const list = await app.inject({
    method: "GET",
    url: "/v1/comics",
    headers: { authorization },
  });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.json().data, { items: [], nextCursor: null });

  const created = await app.inject({
    method: "POST",
    url: "/v1/comics",
    headers: { authorization, "content-type": "application/json" },
    payload: { title: "服务边界测试", format: "page", defaultReadingDirection: "ltr" },
  });
  assert.equal(created.statusCode, 200);
  const comicId = created.json().data.comic.id as string;

  const createdAsset = await app.inject({
    method: "POST",
    url: `/v1/comics/${comicId}/assets`,
    headers: { authorization, "content-type": "application/json" },
    payload: { kind: "scene", name: "测试街区", description: "通过漫画资产创建接口建立。" },
  });
  assert.equal(createdAsset.statusCode, 200);
  assert.equal(createdAsset.json().data.root.name, "测试街区");
  assert.equal(createdAsset.json().data.kind, "scene");

  const mcpUpdated = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: { authorization: mcpAuthorization, accept: "application/json, text/event-stream" },
    payload: {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "lantern_comic_update",
        arguments: { comic: `lantern://comics/${comicId}`, worldSummary: "资源引用测试世界观", idempotencyKey: `api-comic-update-${comicId}` },
      },
    },
  });
  assert.equal(mcpUpdated.statusCode, 200);
  assert.match(mcpUpdated.body, /resource_mutation/);
  assert.match(mcpUpdated.body, /资源引用测试世界观/);

  const fetched = await app.inject({
    method: "GET",
    url: `/v1/comics/${comicId}`,
    headers: { authorization },
  });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.json().data.title, "服务边界测试");
  assert.equal(fetched.json().data.summary, "");
  assert.equal(fetched.json().data.worldSummary, "资源引用测试世界观");
  assert.equal(fetched.json().data.status, "in_progress");

  const updated = await app.inject({
    method: "PATCH",
    url: `/v1/comics/${comicId}`,
    headers: { authorization, "content-type": "application/json" },
    payload: { title: "服务边界测试·已更新", status: "completed" },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().data.title, "服务边界测试·已更新");
  assert.equal(updated.json().data.status, "COMPLETED");

  const chapterCreated = await app.inject({
    method: "POST",
    url: `/v1/comics/${comicId}/chapters`,
    headers: { authorization, "content-type": "application/json" },
    payload: { title: "上传测试一话" },
  });
  assert.equal(chapterCreated.statusCode, 200);
  const chapter = chapterCreated.json().data as { chapterId: string };
  const completedChapter = await app.inject({
    method: "PATCH",
    url: `/v1/comics/${comicId}/chapters/${chapter.chapterId}`,
    headers: { authorization, "content-type": "application/json" },
    payload: { status: "completed" },
  });
  assert.equal(completedChapter.statusCode, 200);
  assert.equal(completedChapter.json().data.status, "COMPLETED");
  const asset = await createComicLibraryAsset(LOCAL_USER_ID, comicId, {
    kind: "character",
    name: "上传测试角色",
    description: "只用于验证一次性上传位置。",
  });
  const upload = await prepareExternalAssetUpload(LOCAL_USER_ID, asset.id, { filename: "reference.png", label: "主参考" });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n0YAAAAASUVORK5CYII=", "base64");
  const uploaded = await app.inject({
    method: "PUT",
    url: `/v1/mcp/uploads/${upload.uploadId}`,
    headers: { authorization: upload.headers.Authorization, "content-type": "image/png" },
    payload: png,
  });
  assert.equal(uploaded.statusCode, 200);
  assert.equal(uploaded.json().data.status, "uploaded");
  assert.equal(uploaded.json().data.uploaded.contentType, "image/png");

  const browserUpload = await app.inject({
    method: "PUT",
    url: `/v1/mcp/uploads/${upload.uploadId}`,
    headers: { authorization: upload.headers.Authorization, "content-type": "image/png", origin: "http://localhost:18788" },
    payload: png,
  });
  assert.equal(browserUpload.statusCode, 403);
  assert.equal(browserUpload.json().error.code, "mcp_origin_forbidden");

  const archived = await app.inject({
    method: "DELETE",
    url: `/v1/comics/${comicId}`,
    headers: { authorization },
  });
  assert.equal(archived.statusCode, 200);
  assert.deepEqual(archived.json().data, { id: comicId, deleted: true });
});
