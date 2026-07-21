import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { createApiApp } from "../apps/api/src/app";
import { getConfig } from "@lantern/server/config";
import { initializeDatabaseConnection, prisma } from "@lantern/server/db";
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
  assert.match(initialized.body, /当前端点只读/);

  const tools = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: { authorization: mcpAuthorization, accept: "application/json, text/event-stream" },
    payload: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  });
  assert.equal(tools.statusCode, 200);
  for (const name of ["lantern_projects_list", "lantern_context_get", "lantern_capabilities_list", "lantern_images_inspect"]) {
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
    payload: { title: "服务边界测试", summary: "验证 API 只负责传输映射。", format: "page", canvasPageMode: "single" },
  });
  assert.equal(created.statusCode, 200);
  const comicId = created.json().data.comic.id as string;

  const fetched = await app.inject({
    method: "GET",
    url: `/v1/comics/${comicId}`,
    headers: { authorization },
  });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.json().data.title, "服务边界测试");

  const updated = await app.inject({
    method: "PATCH",
    url: `/v1/comics/${comicId}`,
    headers: { authorization, "content-type": "application/json" },
    payload: { title: "服务边界测试·已更新" },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().data.title, "服务边界测试·已更新");

  const archived = await app.inject({
    method: "DELETE",
    url: `/v1/comics/${comicId}`,
    headers: { authorization },
  });
  assert.equal(archived.statusCode, 200);
  assert.deepEqual(archived.json().data, { id: comicId, deleted: true });
});
