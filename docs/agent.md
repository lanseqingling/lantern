# Agent

Lantern Agent 是漫画工作台中的创作协作者。它理解当前创作现场，选择必要上下文，回答问题或调用受控创作能力，并把结果以可检查、可拒绝、可恢复的方式交还给用户。它不替用户拥有作品，也不以自动完成整话为目标。

本文是 Agent 整体架构、能力边界、上下文、任务、候选、MCP、Skill 和扩展方向的事实源。UI、内置 Agent 与 MCP 的当前能力拆分和接入差异见[漫画能力矩阵](./capabilities.md)，作品结构与写入不变量见 [LCD](./lcd.md)，对话、任务卡、候选预览等界面呈现见[编辑器体验](./editor.md)；可执行 schema、Capability 与持久化字段仍以代码为准。

## 1. Agent 能力总览

能力按当前状态和后续优先级排列，不使用阶段版本号。每一项是相对独立的 Agent 系统能力，可以单独设计、实现和评估；它们不是把[漫画能力矩阵](./capabilities.md)逐项开放给模型的排期。

| 顺序 | 能力域 | 状态 | 核心设计 | 主要边界 |
|---:|---|---|---|---|
| 1 | 通用 Agent Loop 与语义 Planner | 已落地 | 统一处理回答、补充信息、工具调用和不支持请求；工具 Observation 可回到 Planner 继续规划 | 不以关键词路由或固定业务流程代替语义理解 |
| 2 | 基础上下文与目标解析 | 已落地 | 区分当前视图、选择、显式引用和上传附件；用受控 handle 解析当前页唯一目标 | 不把全部工作区或不可见页面默认送入模型 |
| 3 | Capability Registry 与执行守卫 | 已落地 | 统一声明工具输入、目标、范围、风险、结果与 Agent 权限 | Agent 不直接写 LCD、Prisma 或底层命令 |
| 4 | Task、Candidate 与恢复 | 已落地 | 异步任务、重试、取消、checkpoint、Candidate、revision 冲突和刷新恢复共用一套生命周期 | 任何生成结果都不能静默覆盖工作稿 |
| 5 | 当前创作闭环 | 已落地 | 普通问答与图片理解；单格分镜条目；单格图片生成或替换；角色或场景资产图 | 问答保持只读；写入任务每次只处理一个明确目标并产生单个 Candidate |
| 6 | 外置 Agent、MCP 与 Skill | 进行中 | 接入、能力发现、受控上下文、作品与资产管理已经落地；继续按领域把工作台的稳定创作能力投影到 MCP，并同步补齐 Skill | 当前尚未开放 LCD 编辑、完整 Candidate/Task 生命周期和生成能力；接入方式不改变权限、目标范围、确认和写入边界 |
| 7 | 评测与可观测性 | 优先 | 建立目标识别、上下文命中、越界、无效追问、结构化输出、任务成功率和 Candidate 采用率评测 | 记录决策与证据，不记录思维链或不必要的私有内容 |
| 8 | 动态上下文管理 | 优先 | Capability 声明上下文需求，按任务动态检索、裁剪、排序并解释取舍 | 显式引用和用户本轮要求优先，检索不能扩大写入范围 |
| 9 | 记忆 | 优先 | 分离会话摘要、项目连续性事实、用户偏好和任务临时状态，并提供更新、失效与溯源规则 | 记忆不是作品事实，不能覆盖显式输入或固定版本 |
| 10 | 漫画解析 | 优先 | 解析页面、画格、对白、视觉内容、阅读顺序和叙事关系，形成可引用 Observation | 解析结果默认只读，未经确认不回写作品 |
| 11 | 单格精修 | 规划 | 支持选区、遮罩、扩图、局部重画、受保护区域和候选派生 | 固定目标、参考版本与保护范围；每次结果仍是 Candidate |
| 12 | Workflow | 规划 | 用持久 Workflow Run 编排长任务、阶段检查点、暂停、恢复、取消和重规划 | Workflow 只组合现有工具，不建立第二条写入链路 |
| 13 | 多 Agent | 规划 | 在职责、输入输出和评估标准明确时调度专用 Agent | 子 Agent 共用权限、上下文、工具和审计边界，不能自行扩权 |
| 14 | 多模式 | 规划 | 为聚焦精修、长任务等持续改变交互规则的场景提供显式模式 | 普通创作仍使用统一对话；模式不改变底层写入权限 |

## 2. 设计原则与边界

Agent 需要同时满足四个目标：理解当前创作、让行动可预期、把结果控制权交给用户，并能在任务中断后继续推进。

Agent 不是数据库写入器、JSON Patch 生成器或隐藏自动化脚本。对话、消息、任务、进度、Observation 和 Candidate 都不是作品事实；只有经过领域校验的 ChangeSet 才能产生新的 WorkingRevision。确定性低风险编辑只有在 Capability 明确允许时才能直接提交；生成、结构、多对象和其他高风险变化先成为 Candidate。

能力与运行时保持解耦：新增创作能力通过 Registry 注册输入、目标、上下文需求、风险和结果契约，不修改 Agent Loop；新增模型供应商通过 Provider Adapter 接入，不改变产品任务语义；新增 Workflow 或子 Agent 复用同一套领域服务、Context、Tool、ChangeSet、Task、Candidate 和 revision 边界。

产品内与外置 Agent 是同一能力体系的不同调用入口。适合 Agent 使用的 Capability 在交付时同时评估两类入口；不依赖产品界面的能力可以先由外置 Agent 使用，但必须经过显式权限登记，并遵守相同的目标、上下文、领域服务、ChangeSet、Candidate 和 revision 守卫。接入方式不能把同步原子编辑强制包装成 Task，也不能让 Task 或 Workflow 成为领域能力的前置条件。

## 3. Agent Runtime

```text
Turn Input
  → Context Planner / Builder
  → Planner
  → Tool Registry → Executor / Sub-Agent / Workflow Step
  → Observation
  └───────────────→ Planner（继续或结束）
             ↓
        Checkpoint + Presenter
```

- **Turn Input**：用户消息、当前视图、选择、显式引用、附件和会话标识。
- **Context Builder**：构造可追溯事实并分配受控 handle，不决定执行步骤。
- **Planner**：根据目标、上下文和已有 Observation 选择回复、补充、工具或不支持。
- **Tool Registry**：登记语义 Capability 及其 schema、权限、范围、风险和结果契约。
- **Executor**：执行工具、校验输出并返回 Observation；工具可以要求 Planner 继续下一步。
- **Checkpoint**：保存 step、状态和工具结果，使运行可恢复和重规划。
- **Presenter**：把运行结果投影成消息、任务状态或 Candidate，不参与作品写入。

循环必须设置最大步数、超时、并发、成本和写入范围上限。扩大目标范围、改变保护约束或提高风险必须重新进入守卫或确认边界，不能沿用较小范围的授权。

### 3.1 Planner 与 Prompt Package

所有自然语言 Turn 先进入同一个语义 Planner，不在模型调用前后维护业务关键词路由。Planner 输出结构化 `InteractionPlan`，代码只解析计划、校验 handle 和执行已登记 Capability，不能再次用字符串规则解释用户意图。

System Prompt 由可独立版本化的 Prompt Package 组成：

- `Core Identity`：创作搭档身份、作品控制权和不可越过的边界。
- `Evidence Policy`：本轮要求、引用、选择、Observation、作品上下文和记忆的优先级。
- `Planning Rules`：何时回复、补充、调用能力或说明不支持。
- `Capability Catalog`：由 Registry 动态生成，不复制任务枚举和参数默认值。
- `Output Contract`：计划结构、handle 与字段限制。
- `Response Policy`：用户可见语言、事实声明和内部信息保护。

`InteractionPlan` 至少区分讨论型请求与要求作品变化的操作型请求，并支持 `respond`、`ask_user`、`invoke_capability` 和 `unsupported`。模型只能返回输入中存在的 handle；目标 ID、scope、风险、Task 类型和 Candidate 结果由 Registry 与 Guard 补齐。未知 Capability、非法目标、越界参数或多个未消歧目标不能降级为裸写操作。

Prompt Builder 输出 prompt、上下文策略和 schema 的版本与内容 hash。规划 trace 保存 manifest、结构化计划、证据和守卫结果，用于复现误判与回归评测，但不向普通用户展示。

### 3.2 Capability 与工具契约

每个 Capability 至少声明：

- 稳定 ID、用途和结果类型；
- 输入 schema、目标类型、数量和作用范围；
- 所需上下文、版本固定和可选 Observation；
- 风险、确认、预览、撤销和幂等语义；
- Agent 是否可见，以及对应执行器。

Capability 分别声明 `synchronous` 或 `asynchronous` 执行方式，以及 `observe`、`resource_mutation`、`direct_change` 或 `candidate` effect。只读工具返回 Observation；确定性资源管理调用领域服务；低风险编辑产生经过允许的原子 ChangeSet；异步生成才创建 Task；生成、结构和其他高风险结果形成 Candidate。工具不得把模型输出直接当作数据库操作，也不得让模型决定对象 ID、事务、revision 或资源归属。

## 4. 上下文与记忆

上下文按能力需要构建：交互规划上下文用于理解目标和选择能力，执行上下文按已选 Capability 精确补齐。异步能力把执行上下文冻结到 Task；同步管理或编辑只固定本次调用所需的 owner、目标、输入和 revision。两者共享对象解析和版本规则，执行阶段不能依赖 Planner 未固定的临时信息。

证据优先级为：本轮明确要求 → 显式引用和附件 Observation → 当前选择 → 当前可见视图 → 近期仍有效约束 → 检索与记忆。低优先级信息不得覆盖高优先级事实；冲突会改变写入结果时必须请求用户决定。

当前视图、主页面和选择是独立事实。当前视图决定自然语言可以解析的可见范围；选择只表示用户明确聚焦的对象；显式引用可以固定本轮跨区域证据。Context Builder 为可见对象建立临时目标目录，Planner 只返回 handle，Guard 再解析真实对象、归一所属画格并校验 owner、类型、数量和范围。

当前上下文策略使用有限、可解释的固定档位：普通规划读取创作基线、当前可见页有限 LCD、相关分镜和显式引用；单格任务补充目标画格与有限相邻叙事；资产任务读取故事核心、世界设定、视觉风格和明确参考。图片实际内容只能通过视觉 Observation 进入规划，不能由文字设定或历史消息猜测。

页面理解同时使用结构事实和渲染事实。结构 Observation 从当前 WorkingRevision 投影 PresentationUnit、PageSurface、Frame、元素归属、解析后几何、裁切、遮罩、层级、对白与阅读顺序；最终画面 Observation 使用同一 revision 和正式导出渲染语义合成一个当前页、滚动段或相邻可见页组。结构用于准确定位和参数判断，合成画面用于判断构图、遮挡、留白和视觉节奏；两者不能相互替代，也不能用原始资产图代替最终页面。Observation 只返回当前请求需要的一个或两个展示单元，revision 变化后必须重新获取。这是只读理解基础：上下文中出现 LCD 对象、合成图或目标 handle 不会开放对应编辑，内置 Agent 仍只能执行 Capability Registry 当前显式登记的单格、图片或资产等能力。

执行 snapshot 至少固定用户目标、Capability、scope、base revision、目标对象、关键上下文、资源版本、Planner trace 和省略项。签名 URL、视口坐标和侧栏状态不是长期事实。调试读取必须复用同一 Builder，不能另造一份看似相同的上下文。

### 4.1 动态上下文管理

动态上下文由 Capability 声明需求，再按以下层级构建：必需事实、显式引用、目标连续性、会话约束、项目背景和可选知识。检索器返回来源、版本、相关性与省略原因；Context Policy 负责预算、去重、冲突和裁剪，Planner 不直接遍历整个项目。

上下文质量需要独立评估：既检查是否缺少关键事实，也检查是否加入无关信息导致模型失焦。任何自动检索都不能扩大 Capability 的目标范围或写入权限。

### 4.2 记忆

记忆与作品、上下文 snapshot 和聊天记录分离：

- **会话记忆**：当前讨论形成的目标、约束和未决问题，可随会话归档或压缩。
- **项目记忆**：跨会话仍有效的连续性结论和创作约定，必须有来源和更新时间。
- **用户偏好**：稳定的表达与协作偏好，不替代作品设定。
- **运行记忆**：Workflow 和长任务的 checkpoint，只服务恢复执行。

记忆写入需要明确提取规则、置信度、溯源、更新和失效策略。原始消息不能无限累积为上下文；摘要不能改写原始事实；作品内容仍以 LCD、资产版本和正式设定为准。

## 5. Message、Task、Candidate 与 Workflow

Conversation 是连续协作与恢复的边界；Message 是用户可见的时间线记录。用户输入、Agent 回复、追问、任务事件和候选结果通过稳定 ID 关联，但消息的展示变化不能修改作品、Task 或 Candidate 的事实状态。消息可以保存本轮引用、附件、计划版本和关联运行标识，不保存 LCD 副本、思维链或短期签名资源地址。

只有异步、可取消、可重试或需要持久恢复的动作创建 Task。Task 固定用户、Project、Capability、目标、scope、base revision、context snapshot、Provider、模型、幂等键、Planner trace 和尝试记录。任务状态反映真实运行事实，不保存思维链，也不进入 LCD。

模型输出依次经过结构 schema、业务规则、Capability 和作品协议校验。结构化输出可以按原 schema 自动修复一次；仍不合法则失败且不保存结果。重试必须复用原始 Turn 或已冻结 Task 输入，不能把失败请求改造成另一类能力。

Candidate 至少记录目标、摘要、base revision、来源 Task、固定输入与输出引用、受约束操作和生命周期。应用前重新校验 owner、目标和 revision；工作稿变化后无法安全应用的 Candidate 标记过期。丢弃、失败和取消不创建 revision；应用形成一次原子 ChangeSet，并进入普通撤销历史。

Workflow Run 是 Task 之上的持久编排层：它组合工具和 Task，维护步骤依赖、检查点、阶段输入输出、暂停、恢复、取消和重规划。Workflow 不直接写作品，也不能绕过 Candidate 或用户确认边界。短任务继续使用普通 Task，不为了统一形式强制进入 Workflow。

## 6. 漫画解析、复杂精修与多 Agent

漫画解析把最终合成页面、LCD、画格关系、对白、阅读顺序和叙事线索转换为带来源的 Observation，供问答、上下文检索和后续规划使用。解析器不直接决定创作修改，也不能用视觉推断覆盖已有结构事实。

复杂精修必须固定原图版本、目标区域、遮罩、保护范围、参考资源和期望变化。生成输出创建新 `AssetVersion`，Candidate 只影响声明目标；候选派生保留父结果和修改要求，便于比较而不污染工作稿。

多 Agent 只用于可以独立定义职责、输入输出和评估标准的任务，例如连续性检查、漫画解析或视觉精修。主 Planner 负责授权与汇总，子 Agent 只能使用被委派的上下文和 Tool Registry 子集；所有工具调用、资源版本和结果仍进入统一审计链路。

多模式只解决持续交互规则确实不同的场景。模式可以固定焦点、保护范围、上下文策略和呈现方式，但不能改变 Capability 权限、数据事实源或 Candidate 边界。一次普通对话能够表达的差异不新增模式。

## 7. 外置 Agent、MCP 与 Skill

### 7.1 定位与对齐范围

外置 Agent 是 Lantern 的正式创作入口之一。MCP 向它投影已开放的语义 Capability，应用级 Skill 补充稳定的漫画领域知识和协作方法；两者都不拥有独立权限、领域逻辑或作品状态。外置 Agent 复用 Lantern 的领域服务、Editor Capability、Context、ChangeSet、WorkingRevision、Task 和 Candidate，不建立外置专属写入链路。

当前交付重点是外置 Agent。后续新增或扩展的能力默认只评估并登记外置访问级别，保持内置 Agent 的 Planner、Prompt、上下文策略、可见工具和现有创作闭环不变；只有修复共享事实源或安全守卫时才调整共同基础，且不能因此自动向内置 Agent 开放新能力。

最终对齐工作台 UI 与 MCP + Skill，指持久领域能力对齐，而不是界面控件对齐：

- 工作台已经提供、领域语义稳定且适合外置调用的作品管理与创作动作，都应复用同一领域服务或 Editor Capability，并具有对应的 MCP 能力和 Skill 知识。
- 画布平移、缩放、选择、悬停反馈、工具条、抽屉、虚拟补位页和 Candidate 比较界面属于 UI 交互，不为 MCP 复刻；外置 Agent 使用 Resource Reference、受控 handle、Observation 和结构化结果完成等价目标。
- Undo、Redo 和本地历史游标仍由工作台控制。MCP 直接编辑必须形成一次可撤销的原子 ChangeSet，但外置 Agent 不远程操纵用户的历史游标。
- 尚未成为正式工作台能力的生成、解析、模板或高级精修，不为追求列数相同而先在 MCP 建立第二套实现。
- 每个工作台能力最终都必须在[漫画能力矩阵](./capabilities.md)中表现为 MCP 已接入、部分接入，或附有明确的不接入理由；不能以笼统的“外置 Agent 已支持编辑”代替逐项核对。

领域切片只有同时完成 Capability、MCP 投影、Skill reference、守卫和代表性一致性验收，才算对外开放。Workflow、长任务和多 Agent 只能组合已经开放的原子能力，不能成为基本编辑能力的前置条件。

### 7.2 接入架构

```text
兼容的本地外置 Agent
  ├─ Lantern Skill：领域对象、作用范围和协作知识
  └─ Lantern MCP Server：能力发现、输入输出和调用
         ↓
External Agent Service：身份、所有权、幂等、审计与错误映射
         ↓
Semantic Capability Registry：schema、目标、上下文、风险、权限与 effect
         ↓
  ┌────────────────┬──────────────────┬───────────────────┐
  │ 查询与管理服务 │ Editor Capability │ Generation Runtime │
  │ Comic / Asset  │ LCD / ChangeSet   │ Task / Candidate   │
  └────────────────┴──────────────────┴───────────────────┘
         ↓
领域资源 / WorkingRevision / Candidate / Task
```

MCP 是语义 Capability 的传输投影。MCP handler 只解析协议、建立调用上下文、调用服务并投影结果；不能读取 Prisma、分配领域 ID、拼装 `WorkspaceCommand`、提交任意 ChangeSet 或直接写 LCD。产品内调用直接使用同一语义服务，不绕行 MCP。

作品与资源管理能力通过对应领域服务完成所有权校验、事务和稳定 ID 分配。页面、画格、格内图片、裁切、对白、气泡、旁白、图层和阅读结构等编辑能力通过 Editor Capability 规划强类型命令，并以原子 ChangeSet 产生新的 WorkingRevision。Chapter 创建时形成对应 Project；Project 是一话的工作空间，不作为脱离 Chapter 的独立内容对象创建。

### 7.3 Capability、结果与确认

每项语义 Capability 至少声明稳定 ID 与版本、用途和禁止范围、输入输出 schema、目标类型与数量、作用范围、上下文和版本要求、同步或异步执行方式、结果 effect、风险、确认、撤销、幂等、冲突语义，以及内置和外置 Agent 各自的访问级别。Manifest 是能力目录、MCP tool、服务端执行守卫和已启用 Planner catalog 的共同来源。

| Effect | 适用动作 | 写入规则 |
|---|---|---|
| `observe` | 列表、详情、有限上下文、图片或画面理解 | 不修改任何作品事实 |
| `resource_mutation` | 创建或更新漫画、章节、设定和资产资料 | 调用领域服务；破坏性动作需要明确确认 |
| `direct_change` | 移动画格、调整裁切、修改气泡等确定性原子编辑 | 以 expected revision 提交可撤销 ChangeSet |
| `candidate` | 生成、结构、多对象和其他高风险结果 | 应用前不修改工作稿 |

`execution` 只表示是否需要持久异步运行，`effect` 表示真实作品影响。同步资源管理和原子编辑不得创建虚假 Task；只有异步、可取消、可重试或需要持久恢复的操作创建 Task。Task 完成不能自动应用 Candidate；显式应用仍要校验 owner、目标、状态和 expected revision。

用户已经确认名称、描述和分类，并明确要求保存时，属于结构化资源写入；Agent 仍在替用户决定设定、生成图片或重编页面时，属于生成或高风险结果。是否形成 Candidate 由能力的 effect 和风险决定，不能仅按调用入口判断。

### 7.4 MCP 契约

Lantern 提供只监听 loopback 的 Streamable HTTP MCP endpoint，并使用独立凭证映射到当前本地用户。凭证不写入 Skill、终端输出或作品数据。`lantern agent:install` 识别兼容 Agent，部署应用级 Skill，并只维护客户端中名为 `lantern` 的 MCP 配置；重复运行用于同步 Skill、endpoint 和凭证变化。

每个具有独立权限、风险或输入契约的 Capability 投影为清楚的 MCP tool。schema、描述、读写提示和审批建议从 Manifest 生成或校验；不维护第二份参数定义，也不使用接收任意 `capabilityId + arguments` 的万能写入工具。

漫画和章节使用稳定 Resource Reference，不要求先拉取完整作品列表：

```text
lantern://comics/{comicId}
lantern://chapters/{chapterId}
http://localhost:{webPort}/comics/{comicId}
http://localhost:{webPort}/comics/{comicId}/chapters/{chapterId}?pageId={unitId}
```

解析器校验 owner、资源状态和 Comic → Chapter → Project 关系。Resource Reference 只确定目标，不携带授权；层级不一致、资源不存在或不属于当前用户时直接失败，不能回退为标题搜索。LCD 编辑还必须固定明确 Project、expected working revision 和受控目标引用。

当动作依赖构图、裁切、气泡、遮挡、层级、留白或阅读关系时，Agent 读取同一 WorkingRevision 下一个或两个 PresentationUnit 的场景结构与最终合成图，再使用返回的 frame 或 element handle 调用已开放能力。handle 只用于解析本次受控目标，不能代替稳定引用或扩大写入权限；revision 变化后必须重新读取。合成图复用预览和导出的渲染事实源。

工具返回紧凑结构化结果和适用的资源引用、base revision、working revision、Task、Candidate 与下一步动作，不返回数据库记录、长期资源地址或 JSON 内的大段 base64。图片通过 MCP 原生 image content 传输。外置 Agent 提交图片时，先为明确 Asset 创建短时效 loopback 上传位置，再把 PNG、JPEG 或 WebP 登记为不可变 AssetVersion；客户端路径、对象存储键和上传位置都不能直接写入作品。

所有同步写入要求一个逻辑动作使用稳定幂等键。相同键与相同输入重试返回原结果；相同键绑定不同能力或输入时返回冲突。错误码必须区分所有权、目标缺失、范围不合法、能力未开放、确认缺失、幂等冲突、Candidate 过期和 revision 冲突。

### 7.5 应用级 Skill

Lantern 只分发一个应用级入口 Skill，避免多个同类 Skill 争抢触发。主 `SKILL.md` 保存所有能力共同需要的规则：Lantern 是作品事实源、服从用户明确要求、发现当前能力并选择最窄动作、核心对象和生命周期差异、何时需要上下文或确认，以及不伪造工具、对象 ID、图片证据和应用状态。

稳定领域知识随着对应能力开放进入 `references/`，覆盖漫画与章节、页面与阅读结构、资产与设定、画格与坐标、图片与裁切、对白与气泡、复杂编排、生成结果与 Candidate。reference 解释对象关系、坐标空间、作用范围和常见误用，不复制 MCP schema、当前工具清单、UI 点击步骤、固定 Workflow 或题材手册。

MCP schema 决定工具如何调用，Capability 守卫决定调用是否允许，Skill 说明漫画领域中何时使用。Skill 缺失、过期或未触发时，服务端守卫仍须独立成立。Skill 不跟随每个工具版本更新；只有领域对象语义、通用作用范围、结果 effect 或长期协作方式变化时才同步发布。

### 7.6 外置能力交付顺序

当前接入基线包括安装与身份、能力发现、Resource Reference、受控图片与画面 Observation，以及漫画、章节、结构化资产和固定图片版本管理。当前逐项开放状态只由[漫画能力矩阵](./capabilities.md)维护；后续按以下顺序收敛，不同步扩展内置 Agent。

1. **页面与画格基础编辑**：开放页面或滚动段的创建、命名、复制、排序和删除，以及画格创建、复制、删除、几何、边框、斜切和出血。先建立通用 expected revision、目标 handle、原子 ChangeSet 和刷新后可见的闭环；单对象低风险动作直接变更，结构动作按风险形成 Candidate。
2. **图片、对白与文字编辑**：开放固定 AssetVersion 的放入、更换和移除、格内裁切与变换、纸面图片、基础层级，以及对白、气泡、旁白的创建、内容、位置、尺寸、形状和文字样式。Skill 同步补齐坐标空间、对象归属、裁切和文字语义；需要视觉判断的动作先读取绑定同一 revision 的结构与合成图。
3. **阅读结构与复杂编排**：开放展示单元合并拆分、封面与过场页、叠格、跨页或跨段对象、归属转换和阅读顺序。多对象、跨展示单元或难以安全撤销的结构结果先形成 Candidate，并提供精确影响范围和应用前冲突检查。
4. **Task、Candidate 与生成闭环**：开放 Task 查询、取消、重试和恢复，Candidate 查询、预览数据、应用、丢弃和过期状态；再投影工作台已经具备的单格分镜、整格图片和角色或场景资产图生成。Lantern 托管生成与外置 Agent 提交结果共用目标、资源版本、风险和 Candidate 规则。
5. **版本、阅读与输出收口**：评估并开放保存快照、固定阅读结果、PNG、LCD 和完整归档等适合外置调用的能力；导入或覆盖类动作必须显式确认并原子执行。逐项审计矩阵中已有 UI 能力，为未对齐项给出实现或长期不接入结论，完成工作台、预览、导出与 MCP 对同一作品事实的代表性一致性验收。

每个顺序项都按可独立使用的最小领域切片交付。例如画格几何不能只发布写工具，还要同时具备目标发现、必要 Observation、revision 冲突、Skill 坐标说明和 UI/MCP 结果一致性测试。下一个顺序项不阻止前一项继续补齐，但不能用只注册 schema、只添加 Skill 文案或只接通底层命令宣称能力已开放。

### 7.7 版本、验收与非目标

Capability 使用稳定 ID 和独立版本。目标、影响范围、effect 或必填输入发生不兼容变化时发布新版本；能力目录语义变化时递增目录 revision 并生成稳定内容 hash。每次调整能力都要同步生成或校验 MCP tool、服务端输入和守卫、能力目录，以及当前明确启用的调用入口；外置专属能力不能因共享目录而进入内置 Planner。

每个领域切片至少验证：兼容 Agent 可以发现并执行代表性能力；owner、目标、确认、幂等和 revision 守卫有效；直接编辑只产生一次可撤销 WorkingRevision；结构和生成遵守 Candidate 边界；工作台刷新后可见相同结果；预览和导出读取相同作品事实；Skill 能正确选择能力但不复制 schema；MCP 不暴露 Prisma、对象存储凭证、原始 LCD、`WorkspaceCommand` 或任意 ChangeSet。

外置接入不复刻工作台界面，不开放通用数据库、JSON Patch、LCD 替换或底层命令，不重新实现领域服务与生命周期，不以 Workflow 自动完成整部漫画，也不让 Skill 成为 API 文档、提示词集合或题材百科。

内置与外置 Agent 都要记录 actor、客户端、工具版本、决策、scope、context snapshot、工具调用、校验和最终 revision。审计不保存思维链、完整创作输入、长期资源地址或无关私有内容。

## 8. 评测与可观测性

Agent 评测以真实误判 Case 为核心。每个 Case 固定 Turn、选择、引用、必要上下文、期望计划、Capability 和目标范围；Prompt、Capability 描述、Context Policy 或 schema 变化后运行同一回归集。

核心指标包括目标识别、直接回答正确率、无效追问、上下文命中与噪声、越界、结构化输出、任务成功、Candidate 应用、过期和恢复成功率。线上 trace 记录版本、输入事实摘要、计划、工具、校验和结果，不记录思维链、长期可访问资源地址或无关私有内容。
