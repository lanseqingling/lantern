# AGENTS.md

## Lantern AI

Lantern AI 是面向个人漫画创作者的 AI 漫画创作工作台。它不是一键生成整篇漫画的工具，也不是传统专业绘图软件，而是帮助用户把故事、角色、场景、分镜、编排、单格精修和预览串成一个可持续创作的空间。

核心体验是：用户始终知道自己在创作什么、AI 正在帮助什么、下一步可以确认或调整什么。AI 提供方向、候选和解释，但不替用户夺走创作控制权。

## Repository

仓库包含可运行的 Web、API、Worker、Prisma 持久化、本地对象存储和模型适配。产品语义与作品协议由 `docs/` 说明，字段与运行行为以可执行 schema 和代码为准。本文件只维护仓库导航、稳定技术边界和迭代时必须同步检查的约束。

### 运行结构

```text
React / Vinext Web
  → Fastify API
  → PostgreSQL / Prisma
  → Redis / BullMQ → Worker → Model Provider
  → Local Object Storage
```

- TypeScript 是 Web、API、Worker 和共享包的统一语言。
- `packages/shared` 的 TypeScript / Zod schema 是 LCD、工作区命令和跨进程数据契约的代码事实源。
- PostgreSQL 保存作品与工作流元数据；Redis 只承载异步任务，不是作品事实源。
- 用户上传和模型生成图片进入对象存储；数据库与 LCD 只保存稳定对象键和资源版本引用。
- Provider Adapter 隔离 DeepSeek、Qwen Image 及测试 Provider 的请求格式。

### 目录导航

| 路径 | 职责 |
|---|---|
| `app/` | Vinext/Next 风格路由、工作台、作品页、资产页和阅读预览；`app/lib/api-client.ts` 是当前浏览器 API 客户端。 |
| `apps/api/src/index.ts`、`apps/api/src/routes/` | Fastify 启动入口，以及按 comics、assets、workbench、agent、export 分组的解析、鉴权和响应边界。 |
| `apps/worker/` | 模型生成、导出等异步任务执行。 |
| `packages/agent-runtime/` | 意图判断、上下文构建、Provider 适配和任务生命周期。 |
| `packages/server/` | Prisma 数据访问、对象存储、签名资源、工作稿提交，以及复制、上传、候选应用和导出等服务。 |
| `packages/shared/` | LCD、工作区命令、DTO 和 Zod 可执行契约。 |
| `packages/editor-core/` | 不依赖 UI 或演示数据的确定性 ChangeSet 应用和快照能力。 |
| `packages/demo-runtime/` | 仅供显式 demo adapter 使用的样例场景、候选和交互决策。 |
| `packages/layout-engine/` | 页面编排与布局计算。 |
| `packages/ui/` | 共用图标；设计 token 的代码事实源位于 `app/styles/foundation.css`。 |
| `prisma/` | 数据模型、迁移和基础数据。 |
| `samples/`、`public/samples/` | 隔离的示例漫画与静态样例素材。 |
| `scripts/` | 本地启动、迁移、模型探测和 smoke 脚本。 |
| `docs/` | 产品概要、产品需求、编辑器体验、LCD、Agent 和临时迭代路线。 |

`.lantern-runtime/` 是本地对象存储和临时运行数据，不能作为示例素材或提交内容。

### 作品与前端边界

| 层 | 内容 | 是否进入 LCD |
|---|---|---|
| 漫画层 | 展示单元、纸面、画格、图层、图片、文字和气泡 | 是 |
| 参考层 | 画布参考图、角色/场景对照和临时素材摆放 | 否 |
| 交互层 | 选择、辅助线、工具条、拖拽和浮层 | 否 |
| 协作层 | 对话、任务事件、候选卡、追问和进度 | 否 |

预览和导出只读取 LCD 与固定资源版本，不读取画布摆放、对话或临时 UI 状态。前端交互通过领域命令提交作品变化，不能把组件状态或整个画布 store 当成作品。

### 已落地的运行时边界

- `Comic → Chapter → Project` 是持久化创作层级。`WorkingRevision` 是可变工作稿；`SavedSnapshot` 是用户显式保存后不可变的阅读和导出基线。
- `StoryboardBeat` 是叙事分镜条目；`PresentationUnit → PageSurface → Frame → Layer → Element` 是作品结构。格内元素使用 Frame 局部坐标，资源 URL 位于读取模型，不写回 LCD。
- 移动画格只改 Frame，格内取景只改 `crop`，页面结构使用布局命令，故事节奏通过 StoryboardBeat 表达。破框元素保持 Frame 锚点并在 Unit Overlay 合成；叠格和跨页不得用 CSS 偏移或复制坐标绕过 LCD。
- 确定性手动编辑通过 `WorkspaceChangeSet` 直接形成可撤销 revision。生成、结构调整、多对象操作和其他高风险结果先成为 Candidate，经预览和 ChangeSet 进入作品。
- 页面 Candidate 可以保存为 `PageVariant`；`layout_only` 方案重新应用时必须保留格内内容，删除方案不能删除当前作品。
- 一次会话只允许一个活动任务。任务、候选、消息与作品内容生命周期分离，任何任务都不能静默覆盖工作稿。
- Agent 上下文由持久化工作稿、当前选择、显式引用和当前输入共同构建；任务实际使用的 context snapshot 可追溯。`context-debug` 只读重算相同输入，不创建消息、候选或任务。
- 复制漫画需要重映射章节、项目、工作稿、快照、方案、分镜、资产版本、画布摆放和对象存储键；不复制消息、候选、任务或任务尝试。

### 迭代同步清单

- 新增或删除持久化对象、版本引用或 LCD 对象 ID 时，同时检查 Prisma 迁移、服务层读写、上下文构建、保存快照、导出、复制和 ID 重映射。
- 修改 Agent 可见上下文、选择范围、显式引用或输入数据时，同时检查任务 context snapshot 和 `context-debug` 输出。
- 涉及多个画格或多个范围的 AI 能力，使用“计划 → 分阶段 Candidate → 用户确认 → 基于新 revision 继续”，不得在一个任务里静默重排页面并覆盖多格内容。
- 新增 API 时在 `apps/api` 收口解析、schema 和所有权校验，并在浏览器 API 客户端建立对应调用；不要在组件中散落未约束请求。
- API 路由按领域放在 `apps/api/src/routes/`，复杂复制、上传、候选应用和持久化编排放在 `packages/server`；`apps/api/src/index.ts` 只负责装配与启动。
- 生产工作台只使用 `server` adapter；`demo` 必须由 `NEXT_PUBLIC_LANTERN_RUNTIME_ADAPTER=demo` 显式开启，服务失败不能静默切换到演示作品。
- 新增示例漫画只放在 `samples/` / `public/samples/`，并提供显式 seed/reset 入口；不要污染普通用户数据或运行时对象存储。
- 变更后运行与影响面相符的 `pnpm typecheck`、相关测试和 `pnpm build`。完整本地环境使用 `scripts/start-local.sh`。

## Documentation

- 正式文档直接写产品是什么、规则是什么和如何验收，不记录阶段过程、旧方案或完成日志。
- 临时迭代路线完成一项后删除待办细节和小标题，只保留主章节标题与一句结果；不记录日期、过程或变更清单。
- 除 Agent 文档和临时迭代路线外，`docs/` 不引用源码路径和内部实现符号，也不承担代码导航；LCD 中的稳定对象名与字段名属于作品协议词汇。仓库导航由本文件和根 `README.md` 维护，迭代路线只保留完成未决工作所需的实现入口。
- 每个概念只保留一个主事实源；其他文档使用短引用，不通过补充说明叠加修正。
- 正式产品文档不复制完整 API 路由、Prisma 字段、任务状态、依赖版本或 fixture；必要的实现导航统一放在根目录文档，Agent 设计只短链与其边界直接相关的入口。
- LCD 字段与命令以 `packages/shared` 为准，数据库字段以 Prisma schema 为准，启动和质量命令以 `package.json` 与 `scripts/` 为准。
- 规则改变时直接修改主文档并删除失效内容；过程由 Git 历史追溯。

## Product Sense

- 保持界面和操作简练。优先让用户在一个清晰的创作空间里完成主要动作，避免把简单意图拆成很多模式、表单或配置页。
- 指引要明确。用户应该看得出当前焦点、AI 的理解、影响范围、候选结果和下一步动作。
- 上下文优先。产品应理解当前漫画、剧情、角色、场景、分镜和已完成内容，而不是要求用户反复说明背景。
- 用户掌控优先。AI 可以建议、生成候选和解释取舍，但关键创作结果由用户确认后进入作品。
- 漫画阅读体验优先。当前先完成页漫闭环，在共享能力稳定后逐步引入条漫；固定四格不作为近期推进目标。
- 先做稳定闭环，再做复杂能力。遇到不确定或容易膨胀的能力，优先保留轻量入口和清晰边界。

## Working Here

- 修改文档或代码前先理解它服务的产品体验，不只追求局部实现方便。
- 发现多个文档表达同一概念时，收敛到一个主说明并删除重复内容。
- 对没有讲清的需求按 Product Sense 做保守判断；如果会影响已确认内容、核心作品结构或长期方向，先确认产品选择。
