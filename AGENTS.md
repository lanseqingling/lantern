# AGENTS.md

## Project

Lantern AI 是面向个人漫画创作者的 AI 漫画创作工作台，串联故事、角色、场景、分镜、页面编排、单格精修、预览与导出，并让创作者始终掌握关键创作决定。

仓库包含 Web、API、Worker、Prisma 持久化、对象存储和模型适配。产品语义与作品协议由 `docs/` 说明，字段和运行行为以可执行 schema 与代码为准；本文件只维护仓库导航、稳定技术边界和变更时必须检查的影响面。

## Commands

| 任务 | 命令 |
|---|---|
| 安装依赖 | `pnpm install` |
| 启动完整本地环境 | `scripts/start-local.sh` |
| 启动开发进程 | `pnpm dev` |
| 类型检查 | `pnpm typecheck` |
| 单元测试 | `pnpm test` |
| 构建 | `pnpm build` |

按变更范围运行 `package.json` 中对应的专项测试；提交前至少完成与影响面相符的类型检查、测试和构建。

## Architecture

```text
React / Vinext Web
  -> Fastify API
  -> PostgreSQL / Prisma
  -> Redis / BullMQ -> Worker -> Model Provider
  -> Local Object Storage
```

- TypeScript 是 Web、API、Worker 和共享包的统一语言。
- `packages/shared` 的 TypeScript / Zod schema 是 LCD、工作区命令和跨进程数据契约的代码事实源。
- PostgreSQL 保存作品与工作流元数据；Redis 只承载异步任务，不是作品事实源。
- 用户上传和模型生成图片进入对象存储；数据库与 LCD 只保存稳定对象键和资源版本引用。
- Provider Adapter 隔离不同模型供应商和测试 Provider 的请求格式。

## Repository Map

| 路径 | 职责 |
|---|---|
| `app/` | Web 路由、工作台、作品与资产页面、阅读预览和浏览器 API 客户端。 |
| `apps/api/` | Fastify 启动，以及按领域组织的解析、鉴权和响应边界。 |
| `apps/worker/` | 模型生成、导出等异步任务。 |
| `packages/shared/` | LCD、工作区命令、渲染场景投影、DTO 和 Zod 契约。 |
| `packages/editor-core/` | 不依赖 UI 或演示数据的 Capability、ChangeSet 和快照能力。 |
| `packages/layout-engine/` | 页面编排与布局计算。 |
| `packages/agent-runtime/` | 意图判断、上下文构建、Provider 适配和任务生命周期。 |
| `packages/server/` | Prisma、对象存储、签名资源和持久化业务服务。 |
| `packages/demo-runtime/` | 显式 demo adapter 使用的样例场景与模拟决策。 |
| `packages/ui/`、`app/styles/` | 共用图标、设计 token 和界面样式。 |
| `prisma/` | 数据模型、迁移和基础数据。 |
| `samples/`、`public/samples/` | 隔离的示例漫画与静态样例素材。 |
| `scripts/` | 本地启动、迁移、模型探测和 smoke 脚本。 |
| `docs/` | 产品、编辑器、LCD 和 Agent 的正式文档。 |

## Invariants

- 只有展示单元、纸面、画格、图层、图片、文字和气泡等漫画内容进入 LCD；画布参考、选择、辅助线、工具条、对话、任务和候选卡不进入 LCD。
- 预览和导出只读取 LCD 与固定资源版本，不读取画布摆放、对话或临时 UI 状态。前端通过领域 Capability 提交作品变化，不能把组件状态或整个画布 store 当成作品。
- `WorkingRevision` 是可变工作稿，`SavedSnapshot` 是用户显式保存后的不可变阅读和导出基线。确定性编辑通过 `WorkspaceChangeSet` 形成可撤销 revision；生成、结构、多对象和其他高风险结果先形成 Candidate。
- `WorkspaceCommand` 是编辑器内部的原子写入语言，不直接作为 Agent 工具。UI 与 Agent 通过同一 Capability 输入 schema 和执行器进入 ChangeSet；新 Capability 默认不向 Agent 开放。
- 任务、候选、消息与作品内容生命周期分离，任何任务都不能静默覆盖工作稿。旧 AI 对话与非确定性任务创建已硬冻结，不提供配置开关；会话历史、候选管理和确定性导出继续可用。
- 生产工作台只使用 `server` adapter；`demo` 必须显式开启，服务失败不能静默回退到演示作品。
- `.lantern-runtime/` 只保存本地对象和临时运行数据，不能作为示例素材或提交内容。

## Change Checklist

- 修改持久化对象、版本引用或 LCD 对象 ID 时，先阅读 `docs/lcd.md`，并同步检查 Prisma 迁移、服务层读写、上下文构建、保存快照、导出、复制和 ID 重映射。
- 新增或修改 LCD 可视对象、样式、层级、可见性、坐标或裁切时，同步更新共享场景投影、工作台/预览渲染、导出渲染和一致性测试；已支持字段不得被任一出口静默忽略。
- 新增或重构编辑能力时，在 `packages/editor-core` 维护唯一 Capability schema、元数据和执行器；组件只提交 Capability 输入，多对象编辑先组合能力计划，再合并为一次原子 ChangeSet。原子命令与 ChangeSet schema 放在 `packages/shared`，API、UI 与 Agent 不复制参数契约、ID 或业务默认值，并同步更新 `docs/agent.md` 的能力矩阵；当前用户可用范围变化时同步更新根 README 的能力快照。
- 修改 Agent 上下文、选择、引用、任务或候选时，先阅读 `docs/agent.md`，并同步检查 context snapshot、`context-debug`、stale 校验和用户确认边界。跨画格或跨范围生成必须形成 Candidate；高风险结构变更分阶段确认，不得静默覆盖多处内容。
- 新增 API 时，在 `apps/api/src/routes/` 收口解析、schema 和所有权校验，并在浏览器 API 客户端建立对应调用；复杂持久化编排进入 `packages/server`，`apps/api/src/index.ts` 只负责装配与启动。
- 新增示例漫画时，只写入 `samples/` 或 `public/samples/`，并提供显式 seed/reset 入口，不污染普通用户数据或运行时对象存储。
- 完成变更后运行与影响面相符的 `pnpm typecheck`、专项测试和 `pnpm build`。

## Documentation

- 文档职责、阅读顺序和事实源以 `docs/README.md` 为准。
- 一个概念只保留一个主事实源；规则变化时直接修改主文档并删除失效或重复内容，不在本文件复制产品与协议细节。
- LCD 字段与命令以 `packages/shared` 为准，数据库字段以 Prisma schema 为准，启动和质量命令以 `package.json` 与 `scripts/` 为准。
