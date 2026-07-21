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
