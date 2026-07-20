# Lantern AI

Lantern AI 是面向个人漫画创作者的 AI 漫画创作工作台。它把漫画、一话、故事分镜、页面编排、单格精修、图片资产、对话协作、阅读预览和导出放在一个可持续编辑的空间中。

产品与协议文档从 [`docs/README.md`](./docs/README.md) 进入；仓库导航和开发边界见 [`AGENTS.md`](./AGENTS.md)。

## 当前能力

| 能力 | 当前支持 |
|---|---|
| 漫画与章节 | 创建、编辑和删除漫画与章节，支持页漫和条漫项目 |
| 工作稿与版本 | 持续编辑工作稿，显式保存、撤销、重做并回到最近保存版本 |
| 分镜条目 | 为单个画格创建、绑定和编辑分镜标题与画面描述 |
| 页面与滚动段 | 新增、插入、命名、复制、排序和删除漫画页或滚动段 |
| 双页与复合段 | 合并或安全拆分真正双页与复合滚动段，并保持物理页码和对象归属 |
| 画格编辑 | 新增、复制、删除、移动和缩放画格，调整四角、边框、出血、重叠与层级 |
| 格内图片 | 上传或复用图片，放入画格并调整取景、替换或移除 |
| 纸面图片 | 摆放、移动、缩放和分层管理纸面图片，支持多选移动 |
| 破格与跨范围内容 | 图片支持破格、跨页、跨段和收回；画格与气泡支持跨页和收回 |
| 对白与气泡 | 编辑格内或纸面对白，调整气泡形状、位置、尺寸、旋转、尾巴、排版与样式 |
| 纸面旁白 | 放置、移动、旋转、复制和删除旁白，支持横竖排、字号与换行区域调整 |
| 资产空间 | 上传、整理和复用人物、场景、风格与其他图片，固定版本不受资产列表变动影响 |
| 阅读预览 | 支持单双页分组、真正双页完整显示、条漫连续预览和设备视区辅助 |
| 导出 | 下载当前单页或双页 PNG，并导出完整 LCD |
| Agent 对话 | 支持创作问答、图片理解、目标追问、流式回复和任务过程观测 |
| Agent 创作 | 支持单格分镜条目编辑、单格图片生成或替换，以及角色或场景资产图 Candidate；目标可由选择、引用或当前页语义定位 |

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

图片生成与对话图片理解默认共用百炼 Key；需要独立视觉模型配置时再设置 `.env.example` 中的 `VISION_MODEL_*`。

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
