# Lantern AI

Lantern AI 是面向个人漫画创作者的 AI 漫画创作工作台。它把漫画、一话、故事分镜、页面编排、单格精修、参考资产、对话协作、阅读预览和导出放在一个可持续编辑的空间中。

产品与协议文档从 [`docs/README.md`](./docs/README.md) 进入；仓库导航和开发边界见 [`AGENTS.md`](./AGENTS.md)。

## 本地启动

需要 Node.js 22.13+ 和正在运行的 Docker Desktop。默认 API 端口是 `18787`。

```bash
./scripts/start-local.sh
```

脚本会安装依赖、启动 PostgreSQL 与 Redis、生成 Prisma Client、执行迁移、在空数据库中创建示例数据，并启动 Web、API 和 Worker。没有全局 pnpm 时会使用仓库固定版本。

首次运行会从 `.env.example` 创建 `.env` 并提示填写模型密钥：

```dotenv
TEXT_MODEL_PROVIDER=deepseek
TEXT_MODEL_API_KEY=你的 DeepSeek API Key
IMAGE_MODEL_PROVIDER=qwen
IMAGE_MODEL_API_KEY=你的百炼 API Key
```

密钥只能留在 API / Worker 环境，不能添加 `NEXT_PUBLIC_` 前缀或写入前端代码。

### 手动启动

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

也可以分别运行：

```bash
pnpm dev:web
pnpm dev:api
pnpm dev:worker
```

启动后访问 `/workspace`。浏览器默认通过 Web 的同源代理访问 API；只有需要直连独立 API 地址时才配置 `NEXT_PUBLIC_LANTERN_API_URL`。

默认 `NEXT_PUBLIC_LANTERN_RUNTIME_ADAPTER=server`。只有独立演示时才设为 `demo`；服务端连接失败会明确报错，不会静默切换到演示数据。

## 架构概览

```text
Web（React / Vinext）
  → Fastify API
  → PostgreSQL / Prisma
  → Redis / BullMQ → Worker → DeepSeek / Qwen Image
  → Local Object Storage
```

- `packages/shared` 提供 LCD、工作区命令和 Zod 契约。
- `packages/server` 提供持久化、对象存储、签名资源、工作稿提交、复制和导出。
- `packages/editor-core` 提供确定性的 ChangeSet 应用与快照能力。
- `packages/demo-runtime` 只包含显式演示模式的样例场景和模拟交互。
- `packages/layout-engine` 负责确定性页面布局。
- `packages/agent-runtime` 负责上下文、任务和模型适配。
- `apps/api/src/routes` 按 comics、assets、workbench、agent 和 export 组织 HTTP 边界；复杂编排位于服务层。
- `app/styles/foundation.css` 是设计 token 的代码事实源，其余样式按 workbench、renderer、floating、preview 和 library 拆分。
- `.lantern-runtime/objects` 保存本地用户上传、生成与导出文件，不属于仓库内容。

## 作品语义

故事规划与作品画面分层：

```text
StoryboardBeat
  → PresentationUnit
  → PageSurface
  → Frame
  → Layer / Element
```

WorkingRevision 是可变工作稿，SavedSnapshot 是用户显式保存后的不可变阅读/导出基线。手动确定性编辑通过 ChangeSet 形成可撤销 revision；AI 生成、结构调整和高风险结果先成为 Candidate。资源 URL 不进入持久 LCD。

页漫是当前完整编辑与阅读主线；条漫在共享能力上逐步引入，固定四格不作为近期推进目标。

## 验证

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

Provider contract 测试使用本地测试 HTTP adapter，不消耗模型额度。真实本地联调可先检查 `/health`，再从工作台验证上传、任务、候选、保存和导出。

## 本地安全边界

- `APP_ENV=local` 使用 `LANTERN_DEV_USER_EMAIL` 作为受控本地身份；非本地环境不接受该回退身份。
- API 业务查询继续带 `ownerUserId`；日志脱敏 Authorization、任务 input 和 context snapshot。
- 上传仅接受实际内容校验通过的 PNG、JPEG 或 WebP，单文件上限 50 MB。
- 浏览器通过短期签名 URL 读取私有文件；LCD 不保存长期可访问 URL。
- 对外部署前仍需完成正式账号、备份恢复、保留期清理、内容政策和生产密钥轮换。

## 示例数据

`pnpm db:seed` 会重建本地“雨夜车站”示例，仅用于开发环境。对象文件位于 `.lantern-runtime/objects`，PostgreSQL 与 Redis 数据保存在 Docker volume 中。
