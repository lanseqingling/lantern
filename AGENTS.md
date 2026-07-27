# AGENTS.md

## Project

Lantern AI 是面向个人漫画创作者的开源漫画工作台，串联故事与资产管理、页面与画格编排、单格精修、预览与导出，并通过 MCP + Skill 接入外部 AI Agent，同时让创作者始终掌握关键创作决定。

内置 Agent 当前暂不迭代；除非任务明确要求，不扩展其能力。

本文件只提供开发 Agent 所需的仓库入口、稳定边界和交付要求。产品规则与协议由 `docs/` 维护，字段和运行行为以可执行 schema 与代码为准；不要在这里复制功能清单、接口目录或阶段状态。

## Commands

| 任务 | 命令 |
|---|---|
| 安装依赖 | `./lantern setup` |
| 启动本地产品 | `./lantern start` |
| 启动开发进程 | `./lantern dev` |
| 运行时诊断 | `./lantern doctor` |
| 安装外部 Agent 应用接入 | `./lantern agent:install` |
| 创建一致备份 | `./lantern backup:create` |
| 恢复一致备份 | `./lantern backup:restore <backup-file>` |
| 类型检查 | `./lantern typecheck` |
| 单元测试 | `./lantern test` |
| 构建 | `./lantern build` |
| 打包源码发行包 | `./lantern package:release` |

按变更范围运行 `package.json` 中对应的专项命令；交付前至少完成相符的类型检查、测试和构建。

## Repository Guide

| 路径 | 职责 |
|---|---|
| `apps/web/`、`apps/api/` | Web 界面与 loopback API 入口。 |
| `packages/shared/` | 跨端协议、schema 与共享领域类型。 |
| `packages/editor-core/` | 与 UI 解耦的编辑 Capability、变更和快照能力。 |
| `packages/agent-runtime/` | Agent 规划、上下文、工具与任务运行时。 |
| `packages/server/` | 持久化、对象存储和服务层业务编排。 |
| `packages/` 其他目录 | 可复用的领域、渲染、布局、演示和 UI 模块。 |
| `prisma/` | 数据模型与迁移。 |
| `docs/` | 产品、交互、协议和 Agent 的正式文档。 |
| `samples/`、`apps/web/public/samples/` | 显式示例作品与静态素材。 |
| `scripts/`、`tests/` | 启动、构建、打包、诊断脚本与自动化验证。根目录 `lantern`/`lantern.cmd` 只提供薄命令入口。 |
| `skills/` | 随 Lantern 分发的应用级 Agent Skill 源；由应用安装器部署到目标 Agent 的用户级目录，不作为仓库开发 Skill 自动发现。 |

## Architecture Boundaries

- TypeScript 是应用与共享包的统一语言；共享契约只保留一个代码事实源。
- Workspace 之间只能通过已声明的 `@lantern/*` 依赖和公开 `exports` 协作；不得跨包引用其他模块的 `src`、内部文件或依赖根目录偶然提升的第三方包。
- Web 通过 API 访问服务端能力。路由负责请求解析、鉴权和响应边界，领域逻辑与持久化编排进入对应服务或领域包。
- SQLite 保存作品和工作流事实；Local Task Runner 只负责唤醒与进程内并发，不能成为任务或作品事实源。
- 图片等二进制内容进入用户数据目录中的本地对象存储；数据库与作品协议只保存稳定对象键和版本引用。
- 数据库、对象、配置、日志和临时文件必须通过统一 runtime paths 解析；生产数据不得写入仓库、安装目录或当前工作目录。
- 备份只包含作品事实与对象文件，不包含 Provider Key、安装令牌和日志；恢复必须先完成 manifest、SHA-256 与 SQLite 完整性校验，并在服务停止时原子替换数据库和对象目录。
- 本地 API 只监听 loopback，并通过安装级令牌映射到稳定本地用户；请求头不能切换用户身份。
- 确定性编辑通过领域 Capability 产生原子变更。组件、Agent 和 API 不各自复制参数契约、对象 ID 规则或业务默认值。
- 生产、演示和测试运行时必须明确隔离；生产失败不得静默回退到 mock 或示例数据。

## Product Invariants

- 作品协议只保存漫画内容。画布辅助信息、选择、工具条、对话、任务和候选展示不进入作品协议。
- 工作稿是可变创作状态；用户保存后的快照是不可变阅读与导出基线。预览和导出只读取作品协议与固定资源版本。
- 确定性低风险编辑可以直接形成可撤销变更；生成、结构、多对象和其他高风险结果先形成 Candidate，不能静默覆盖工作稿。
- 外部 Agent 的一话内容编辑先推进隔离 AgentDraft，完成后冻结 ChangeProposal；只有 Lantern 中可验证的用户应用动作才能原子创建正式 WorkingRevision 与 SavedSnapshot。
- UI 与通过 MCP 接入的外部 Agent 共用领域 Capability。Agent 只能调用明确登记的语义能力，不能直接写作品协议、数据库或底层命令。
- 任务、消息、候选和作品内容具有独立生命周期。取消、失败、重试或删除会话不得破坏已经确认的作品。
- 示例数据只存在于显式 demo、seed 或 sample 范围；普通用户数据和生产加载路径不能依赖示例作品。

## Working Rules

- 修改前先阅读对应正式文档和邻近实现，按现有领域边界完成最小一致变更。
- 保留用户已有改动，不清理无关工作区，也不使用破坏性 Git 操作。
- 共享 schema、领域能力、设计 token 和通用组件只保留一个事实源；确认无引用后删除过期实现。
- UI 优先复用现有组件和设计语言，不交付浏览器默认外观或重复的交互组件。
- 产品预置且用户可见的固定文案集中维护在 `apps/web/app/lib/ui-copy.ts`；前端改动交付前语义检查本次涉及的 TS/TSX 文案、错误、Toast、表单、ARIA 和页面元信息。
- 生产命名使用稳定领域语义，不包含阶段、实验或示例作品名称。
- 兼容代码必须有迁移目标和删除条件；数据库变化新增迁移，不改写已经提交的历史迁移。
- 结构重构与行为扩展分开处理，避免在同一改动中顺带更换基础技术或重做无关界面。
- 文件大小本身不是拆分依据；继续开发会让入口、路由或页面组件承担新的独立职责时，先把本次涉及的职责提取为可独立理解和测试的 service、hook 或 component，不顺带重构无关部分。

## Change Impact

- 作品对象、坐标、层级、资源或版本规则变化时，同步检查编辑、持久化、复制、预览、普通导出、完整 LCD 归档导入导出和一致性测试。
- 编辑能力变化时，维护唯一 Capability 契约，并检查 UI、Agent 权限、撤销和 Candidate 边界。
- Agent 的上下文、选择、引用、任务或候选变化时，检查上下文快照、目标归属、版本固定、过期校验和用户确认边界。
- API 变化时，检查输入 schema、所有权校验、服务层和浏览器客户端；完整 LCD 归档还要同步检查共享 manifest schema、导出接口、导入接口和 Web 入口，不能发布只能导出或只能导入的单向格式；不要把复杂业务编排留在启动入口或路由中。
- 用户可见范围或行为变化时，同步更新对应正式文档；能力总览变化时同步 README 和 Agent 能力矩阵。
- 漫画可视行为变化时，工作台、阅读预览和导出必须保持一致。

## Documentation

- 文档职责、阅读顺序和事实源以 `docs/README.md` 为准。
- 一个概念只在一份正式文档中完整说明；其他文档只保留必要引用。
- 正式文档描述当前最终规则，不记录补丁过程、失效方案或实现日志。
- LCD 与工作区契约以共享 schema 为准，数据库字段以 Prisma schema 为准，命令以 `package.json` 和 `scripts/` 为准。
