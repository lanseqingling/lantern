# Lantern AI

Lantern AI 是面向个人漫画创作者的 AI 漫画创作工作台。它把漫画、一话、故事分镜、页面编排、单格精修、参考资产、对话协作、阅读预览和导出放在一个可持续编辑的空间中。

产品与协议文档从 [`docs/README.md`](./docs/README.md) 进入；仓库导航和开发边界见 [`AGENTS.md`](./AGENTS.md)。

## 快速开始

需要 Node.js 22.13+ 和正在运行的 Docker Desktop。默认 API 端口是 `18787`。

```bash
./scripts/start-local.sh
```

脚本会安装依赖、启动 PostgreSQL 与 Redis、生成 Prisma Client、执行迁移、在空数据库中创建示例数据，并启动 Web、API 和 Worker。没有全局 pnpm 时会使用仓库固定版本。

启动后访问 `/workspace`。浏览器默认通过 Web 的同源代理访问 API；只有需要直连独立 API 地址时才配置 `NEXT_PUBLIC_LANTERN_API_URL`。

## 配置

首次运行会从 `.env.example` 创建 `.env` 并提示填写模型密钥：

```dotenv
TEXT_MODEL_PROVIDER=deepseek
TEXT_MODEL_API_KEY=你的 DeepSeek API Key
IMAGE_MODEL_PROVIDER=qwen
IMAGE_MODEL_API_KEY=你的百炼 API Key
```

密钥只能留在 API / Worker 环境，不能添加 `NEXT_PUBLIC_` 前缀或写入前端代码。

默认 `NEXT_PUBLIC_LANTERN_RUNTIME_ADAPTER=server`。只有独立演示时才设为 `demo`；服务端连接失败会明确报错，不会静默切换到演示数据。

## 手动开发

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm infra:up
pnpm db:generate
pnpm db:migrate
pnpm db:seed:if-empty
pnpm dev
```

Web、API 和 Worker 也可以分别启动：

```bash
pnpm dev:web
pnpm dev:api
pnpm dev:worker
```

## 架构

```text
Web (React / Vinext)
  -> Fastify API
  -> PostgreSQL / Prisma
  -> Redis / BullMQ -> Worker -> Model Provider
  -> Local Object Storage
```

- `packages/shared` 提供 LCD、工作区命令和 Zod 契约。
- `packages/editor-core` 与 `packages/layout-engine` 提供确定性编辑和页面布局能力。
- `packages/server` 负责持久化与对象存储，`packages/agent-runtime` 负责上下文、任务和模型适配。
- API 路由只收口请求边界，复杂持久化编排位于服务层；完整目录职责见 [`AGENTS.md`](./AGENTS.md)。

## 验证

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

Provider contract 测试使用本地测试 HTTP adapter，不消耗模型额度。真实本地联调可先检查 `/health`，再从工作台验证上传、任务、候选、保存和导出。

## 本地数据与部署

- `pnpm db:seed` 会重建本地“雨夜车站”示例，仅用于开发环境。
- `.lantern-runtime/objects` 保存本地上传、生成与导出文件；PostgreSQL 与 Redis 数据保存在 Docker volume 中。这些内容都不属于仓库。
- `APP_ENV=local` 使用 `LANTERN_DEV_USER_EMAIL` 作为受控本地身份；非本地环境不接受该回退身份。
- 私有文件通过短期签名 URL 读取，密钥、Authorization、任务输入和上下文不能进入前端代码或未脱敏日志。
- 对外部署前仍需完成正式账号、备份恢复、保留期清理、内容政策和生产密钥轮换。
