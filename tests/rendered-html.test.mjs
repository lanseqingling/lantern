import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Lantern workspace entry", async () => {
  const response = await render("/workspace");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Lantern AI/);
  assert.match(html, /当前创作空间/);
  assert.match(html, /漫画列表/);
  assert.match(html, /新建漫画/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/);
});

test("server-renders the demo runtime workbench route", async () => {
  const response = await render("/comics/comic-rainy-station/chapters/chapter-rainy-station-01");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /创作空间/);
  assert.match(html, /漫画页/);
  assert.match(html, /Page 01/);
});
