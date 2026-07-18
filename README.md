# Lantern AI

Lantern AI 是面向个人漫画创作者的 AI 漫画创作工作台。它把漫画、一话、故事分镜、页面编排、单格精修、参考资产、对话协作、阅读预览和导出放在一个可持续编辑的空间中。

产品与协议文档从 [`docs/README.md`](./docs/README.md) 进入；仓库导航和开发边界见 [`AGENTS.md`](./AGENTS.md)。

## 当前能力

| 范围 | 当前可用能力 |
|---|---|
| 作品组织 | 创建、编辑和删除漫画与章节，在工作稿中持续创作、显式保存并可回到最近保存版本 |
| 分镜与页面 | 为画格创建和编辑分镜描述；新增、命名和删除漫画页或滚动段；相邻页面可合并为真正双页，相邻滚动段可合并为复合滚动段并安全拆分 |
| 画布编辑 | 新增、复制、删除、移动、缩放、四角斜切、边框粗细和叠放画格；管理格内与纸面图片，并支持图片破格/跨页/跨段、画格与气泡跨页、收回、多选移动和原子撤销 |
| 对白与气泡 | 新增、复制、编辑和删除格内或纸面对白，支持破格、收回，以及气泡位置、尺寸、旋转、尾巴、横竖排、自动换行换列、字号、边框粗细、无尾切角八边形和基础形状调整 |
| 纸面旁白 | 从底部文字工具放置透明旁白，支持移动、拉伸换行区域、字号编辑、横竖排、派生编号、复制和删除 |
| 资产与参考 | 上传并整理人物、场景和风格图片，在画布摆放参考、显式引用或沉淀为可复用资产；可从资产详情删除资产且不破坏已放置的固定版本 |
| 阅读与输出 | 普通单双页分组、真正双页不可拆显示、条漫连续预览与设备视区辅助；按物理页或物理段下载 PNG，并导出完整 LCD |
| AI 协作 | 保留会话、上下文和候选确认基础；自动编辑执行入口当前冻结，后续通过受控 Capability 逐步开放 |

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
