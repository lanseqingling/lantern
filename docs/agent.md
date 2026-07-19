# Agent

Lantern Agent 是漫画工作台中的创作协作者。它理解用户当前在做什么，选择必要上下文，提出建议或调用受控创作能力，并把结果以可理解、可拒绝、可恢复的方式交还给用户。它不替用户拥有作品，也不以自动完成整话为目标。

本文是 Agent 产品行为、交互循环、上下文、任务、候选和分阶段实现的事实源。作品结构与写入不变量见 [LCD](./lcd.md)，工作台呈现见[编辑器体验](./editor.md)；可执行 schema、Capability 与持久化字段仍以代码为准。

## 1. 设计目标与边界

Agent 需要同时满足四个目标：

- **理解当前创作**：从用户输入、选择、显式引用和作品状态中识别真实目标，减少重复说明。
- **行动可预期**：执行前说明焦点、范围和关键参考；执行后说明实际结果与未完成部分。
- **结果可控制**：生成、结构、多对象和高风险变化先成为 Candidate，用户决定应用、继续修订或丢弃。
- **持续推进**：对话、任务与候选可以跨页面恢复，但每一步都基于最新工作稿和固定资源版本。

Agent 不是任意数据库写入器、JSON Patch 生成器或隐藏工作流引擎。它只能调用登记过的语义 Capability，不能直接拼装 `WorkspaceCommand`、修改 LCD、调用 Prisma，或让模型决定对象 ID、事务和 revision。对话、任务、进度和候选都不是作品事实；只有合法 ChangeSet 才能产生新的 WorkingRevision。

## 2. 产品交互

每条用户消息开启一个 Agent Turn。Planner 可以直接回答，也可以调用工具；工具结果可以回到 Planner 继续规划，直到完成、等待用户或达到运行上限。

| 用户可见状态 | 使用条件 | 界面行为 |
|---|---|---|
| 直接回复 | 问答、建议或无需工具 | 普通消息流式显示，不创建 Task |
| 等待补充 | 缺少目标或关键约束 | 继续以普通消息说明缺少的信息；可附快捷选项，不使用结果卡 |
| 等待确认 | 整页、整话、结构或范围存在风险 | 确认卡展示目标和范围；确认后才创建 Task |
| 运行中 | 已调用异步生成工具 | 原位任务卡展示真实阶段和停止入口 |
| 候选结果 | 输出校验并持久化完成 | 原位变为 Candidate 卡；查看、应用或丢弃 |
| 失败/取消 | Provider、校验、队列失败或用户停止 | 原位显示原因；可重试或关闭，工作稿不变 |

同一会话 P0 同时只运行一个前台任务。任务期间输入框仍可编辑并保留草稿，但不能继续发送；任务卡右侧的 X 是唯一取消入口，点击后需再次确认。任务完成后用户再发送下一条消息。运行过程只展示准备上下文、排队、生成、校验和保存候选等事实，不展示思维链或伪造百分比。刷新或重连后从持久化 Message、Task 和 Candidate 恢复同一状态。

发送后先用轻量动态状态表示 Agent 正在处理；得到可展示文本后在原消息位置流式追加，不为普通回复反复弹出全局提示。用户显式引用的画格、对白或资产以较小的灰色引用行显示在该条消息正文之前，多个引用以空格分隔且不显示 Markdown `>` 字符；消息发送后清空输入区中的本轮引用。输入区待发送图片和已发送消息附件都可单击进入内置图片查看器；待发送图片仅右侧 `X` 取消引用。任务 Candidate 的生成图可点击进入内置图片查看器。只有工作流状态已经结束的 Candidate（已保存、已应用、已回退、已丢弃或已过期）提供带上下三角的展开/收起；待应用和仍可能继续进入预览或取消预览的状态不提供该控制。只读“查看”不改变终态判断：已保存资产默认展开，底部左侧提供较宽的“查看”进入资产空间，右侧可收起或展开结果；已丢弃和已过期默认折叠，展开仍可查看原结果。

P0 只有统一的创作对话，不要求用户预先选择内容类型。Agent 根据自然语言、显式引用和当前目标决定普通讨论或创建 Candidate：讨论、设计和完善角色/场景设定时直接回答；明确要求生成、创建或制作角色/场景图片、卡片或资产时创建资产 Candidate。只有 Workflow、聚焦精修等会持续改变交互规则、且不适合普通对话临时表达的特殊场景，才在后续增加独立模式。

普通问答需要以漫画创作搭档的身份自然回应。面向用户的消息不得复述 Capability 白名单、阶段编号、任务类型、内部路由、模型供应商或“开放/封禁”等实现信息；暂不可执行的请求只解释当前这项操作，并给出最接近的可行入口。

当前会话 ID 保存在工作台 URL 中，刷新后继续加载同一会话；无效或已归档 ID 回退到可用会话并修正 URL。页面首次载入或切换会话时，对话定位到最新消息；用户主动收起再展开 Agent 时保留原阅读位置，不重新定位。

生成结果必须成为 Candidate。应用时重新校验 owner、base revision 和目标；工作稿 revision 变化后，仍基于旧 revision 的未处理 Candidate 标记为 stale 并拒绝应用。过期卡保持普通白底，右上角标记“已过期”，折叠展示且不提供操作。丢弃、失败和取消不创建 revision；已应用结果只通过工作台底部撤销回退，Candidate 卡不提供单独撤回按钮。

## 3. Agent Runtime

Agent Core 是与 UI、HTTP、模型供应商和具体创作工具解耦的循环：

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

- **Context Builder** 构造当前 Turn 的事实，不决定执行步骤。
- **Planner** 根据目标、上下文和已有 Observation 选择下一工具或完成；四种交互结果只是 P0 可见结果，不是写死的流程状态机。
- **Tool Registry** 只注册有 schema、权限、风险和结果契约的语义工具。模型不能直接生成 `WorkspaceCommand` 或访问 Prisma。
- **Executor** 执行工具、校验输出并返回 Observation；`continueLoop` 允许 Planner 基于结果继续调用下一步。
- **Checkpoint** 保存 step、状态和工具结果，使长任务可暂停、恢复和重规划；P0 checkpoint 随 Turn 持久化，P2 再提升为独立 Workflow Run。
- **Presenter** 把同一 Turn 的运行状态归并为回答、确认、任务或 Candidate 卡片。

循环有最大步数、超时、并发和写入范围上限。扩大范围、改变保护约束或提高风险必须再次获得用户确认。未来的检索器、专用 Planner、子 Agent 和 Workflow 都作为受约束工具或调度器接入同一循环，共用 Context、Task、Candidate 和 revision 边界，不建立第二条写入链路。

风险处理保持简单：只读请求直接回答；明确目标的局部生成进入 Candidate；跨格与整话生成先确认；确定性编辑只有在对应 Capability 开放给 Agent 后才可直接提交原子 ChangeSet。

### 3.1 语义 Planner 与 Prompt Package

所有自然语言 Turn 都先进入同一个语义 Planner，不在模型调用前后维护“重画、生成角色、编排”等业务关键词路由。Planner 理解用户期望的产物、目标对象和范围，输出结构化 `InteractionPlan`；代码只根据 Capability Registry、真实对象和权限解析计划，不能重新解释用户句子。工作台按钮等已经明确绑定 Capability 的确定性入口可以直接提交领域输入，不需要伪装成自然语言。

模型最终接收一段完整 System Prompt，但源码按职责组合为 Prompt Package：

- `Core Identity`：Lantern 创作搭档身份、作品控制权和不可越过的边界。
- `Evidence Policy`：本轮要求、显式引用、图片 Observation、当前选择、作品上下文和近期对话的优先级。
- `Planning Rules`：何时回复、追问、调用能力或说明不支持。
- `Capability Catalog`：运行时从 Agent Capability Registry 生成，不在 Prompt 中复制任务枚举和参数默认值。
- `Output Contract`：`InteractionPlan` 的结构、handle 规则和字段限制。
- `Response Policy`：用户可见语言、禁止泄露的内部信息和不得假装已修改作品等规则。

Capability Catalog 完整列出当前可执行范围。用户以命令或请求语气提出未登记的编辑、生成或结构操作时，Planner 必须返回 `unsupported`，不能改成追问参数或假装可以继续执行；`ask_user` 只用于已登记能力缺少必需目标的情况。页面中存在某类对象并不代表 Agent 已获得对应编辑能力。

Prompt Builder 输出 `promptId`、语义版本、上下文策略版本、输出 schema 版本和内容 hash。每次规划把 manifest 与结构化 Plan 写入消息或 Task 的诊断元数据；它们用于重现误判和比较版本，不进入 LCD，也不向普通用户展示。新增 Capability 通常只修改 Registry 描述和执行器；改变通用理解原则才升级 Planner Prompt 版本；改变字段含义或兼容性才升级 Plan schema。

规划调用使用受控 handle，不允许模型产生对象 ID。输入形态为：

```json
{
  "turn": { "message": "改写当前格的分镜条目" },
  "workspaceView": { "unitIds": ["page-01", "page-02"], "label": "Page 01–02", "physicalPageNumbers": [1, 2] },
  "focus": { "handle": "selection", "type": "comic_frame", "label": "画格 01" },
  "currentPageTargetCatalog": [{ "handle": "current-page:storyboard:1", "type": "storyboard_beat", "label": "铃声之后", "frameLabel": "画格 01" }],
  "explicitReferences": [{ "handle": "ref:0", "type": "canvas_element", "label": "画格 01" }],
  "attachments": [],
  "observations": [],
  "context": { "creativeBaseline": {}, "currentView": {}, "currentPageTargets": [], "currentViewLcd": [] }
}
```

`InteractionPlan` 先以 `requestType` 区分讨论型 `conversation` 与要求作品发生变化的 `operation`，再输出四种 outcome：`respond`、`ask_user`、`invoke_capability` 和 `unsupported`。`respond` 只能用于 conversation，其余 outcome 只能用于 operation。调用能力时输出 Catalog 中的 `capabilityId`、目标 handle、归一化 goal 和 arguments；目标 ID、scope、风险、确认方式、Task 类型与 Candidate 结果由 Registry 和守卫补齐。例如：

```json
{
  "outcome": "invoke_capability",
  "requestType": "operation",
  "goal": "重新形成画格 01 的画面描述",
  "capabilityId": "storyboard.edit_single_entry",
  "targetHandles": ["selection"],
  "arguments": { "instruction": "改写当前格的分镜条目" },
  "evidenceHandles": ["selection"],
  "confidence": 0.96
}
```

`confidence` 只用于评测，不能授权能力或绕过追问。守卫必须确认 Capability 已登记、目标 handle 能解析、对象属于当前用户、目标类型与数量合法、scope 不超过能力声明，并在创建 Task 时重新冻结执行上下文。未知 Capability、非法目标或越界参数永远不能降级为裸写操作。

图片附件以固定 `AssetVersion` 进入规划输入，当前页目标目录也列出对象实际关联的固定图片版本。Planner 只有在理解或回答依赖图片可见内容时才调用只读 `context.inspect_images`；它必须提供上传图片或当前页唯一目标的 handle，不能遍历未指明的页面图片。视觉结果作为 Observation 回到同一 Loop，Planner 再决定回复或创建任务。视觉工具不读取故事上下文、不直接回答用户、不创建 Candidate，因此图片问答和参考图生成不需要两套特殊路由。

Prompt 迭代以真实误判 Case 驱动。每个 Case 固定 Turn、选择、引用、必要上下文、期望 outcome、Capability 和目标范围；修改 Prompt、Capability 描述或 Plan schema 后运行整套语义评测，至少观察错误任务率、无效追问率、越界率、直接回答正确率和结构化输出失败率。示例用于评测和解释原则，不作为不断追加同义词的补丁区。

本地可用 `pnpm agent:probe` 调用已配置的文字模型运行一组最小语义回归，覆盖普通问答、单格分镜条目编辑、格内图片请求边界、资产生成、设定讨论、不支持操作和图片 Observation 闭环；单元测试另行覆盖 Registry 与守卫，不把线上模型波动引入默认测试套件。

### 3.2 单格分镜条目能力

单格分镜条目与格内图片是两个不同产物。前者是 `StoryboardBeat` 的文字标题和画面描述，后者是画格中引用固定资源版本的 `ArtElement`。Planner 根据用户期望的产物判断，不根据“画面”一词机械归类。

- **触发**：用户明确要求创建、编辑、改写或替换唯一目标画格的分镜条目、文字分镜或画面描述。目标既可来自当前选择或显式引用，也可由用户通过当前页的画格编号、对白/气泡编号、分镜标题或唯一画面语义指明。
- **目标**：Guard 最终必须解析出恰好一个当前页 `comic_frame`；指向分镜、对白、气泡或格内元素时归一到所属画格。已有条目时更新同一个 `StoryboardBeat`，没有条目时创建并绑定一个新条目。
- **结果**：只产生包含标题和描述的单个 Candidate；应用后形成一次原子 ChangeSet，丢弃时工作稿不变。
- **不触发**：讨论分镜思路时直接回复；没有选择且语言也不能唯一定位时请求补充；多个可能画格时追问，整页或整话范围返回不支持；对白、画格几何、页面编排和格内图片都不能进入该任务。
- **画面生成边界**：“重新生成单格画面”“重画当前格”默认指格内图片生成或替换，进入独立的 `frame_image.generate_or_replace` Capability，不能降级为修改 `StoryboardBeat`。
- **歧义处理**：仅说“调整这一格”等无法判断期望产物的请求不创建 Task；Agent 先询问要编辑文字分镜还是重新生成格内图片。

这些边界由 Capability Registry 进入 Planner Catalog：描述声明文字产物和排除范围，target contract 声明 `comic_frame` 与 `min=max=1`。Planner 只能返回受控 handle，Guard 再以当前页目录和真实 LCD 校验归属并生成规范化画格选择。面向用户的运行提示和 Candidate 标题统一使用“编辑分镜条目 · 画格标签”，避免把文字分镜误解为图片生成。

## 4. 上下文

上下文分两次构建：通用 `interaction` 规划档位用于理解目标和选择下一步，执行上下文再按已选 Capability 精确补齐并冻结到 Task。规划档位不能预先猜测 `storyboard` 或 `asset_parse`；两阶段共享对象解析与版本规则。

证据优先级为：本轮明确要求 → 显式引用 → 当前选择及其所属画格/页面 → 当前画布视图弱信号 → 近期仍有效约束。冲突会改变写入结果时必须追问；没有冲突时采用最小写入范围。

当前画布视图、主页面和当前选择是独立输入。`currentView` 由工作台实际展示的 PresentationUnit 决定：单页模式为一个单元，双页查看最多包含两个单元，真正跨页仍是一个单元；`currentPage` 记录视图中的主单元；`selection` 只描述用户明确选中的对象。自然语言目标可在整个 `currentView` 中解析，但不能扩展到当前不可见页面。切页后遗留在视图外的旧选择会被服务端降为无选择，不能覆盖 `currentView`。规划 trace 和 `context-debug` 同时记录三者，便于判断上下文定位错误。

每次交互规划都附带当前可见页有限 LCD 和 `currentPageTargets` 只读目录。目录为最多两个可见 PresentationUnit 中的画格、分镜条目、对白/气泡、图片和文字分配临时 handle，并提供页面标签、界面编号、名称、简短内容、所属画格及关联资源版本。它只是理解上下文，不代表用户选择了其中所有对象；只有本轮语言能在整个可见目录中唯一定位时，Planner 才能返回对应 handle。双页中重复的“画格 01”等编号必须结合页码或其他语义消歧。Guard 将分镜或格内元素归一到所属画格，未知 handle、不可见页对象、无归属对象和多画格结果都不能创建 Task。

执行 snapshot 包含用户目标、scope、base revision、当前对象、按任务选取的基础事实、固定资源版本和 `omittedContext`。可版本化对象必须固定 `versionId`；签名 URL、画布视口和侧栏状态不作为长期事实。

P0 使用可解释的固定上下文档位，而不是发送全部工作区：

- 普通规划读取漫画创作基线、当前画布视图中最多两个 PresentationUnit 的有限 LCD 与分镜窗口，同时提供只允许解析当前可见页的目标目录，并展开用户显式引用的画格、关联画面描述、对白文本和固定图片版本；即使没有开放对应写入能力，也可以基于这些事实进行分析和讨论。对话上传图片先保存为隐藏的固定 `AssetVersion`；上传图片或当前页资源的实际画面内容都只通过视觉 Observation 进入 Planner，不能由分镜、故事或历史对话补全。
- 资产创建读取漫画基础信息、故事核心、世界设定、视觉风格文字与风格图片，额外设定卡最多 6 张、近期对话最多 4 条；普通资产只有被用户显式引用时进入。
- 单格分镜条目编辑在创作基线上增加当前章节、已经解析并冻结的目标画格、当前页 LCD，以及关联条目和前后相邻条目的有限窗口；只创建或更新目标画格绑定的一条 `StoryboardBeat`。

P1 将由 Capability 声明上下文需求，并按“必需事实、显式引用、连续性、会话、项目背景”动态检索与裁剪。

`context-debug` 只读调用同一 Builder，展示实际输入和省略项，不创建消息、任务或候选。Agent 只能声称使用 snapshot 中存在的信息。

## 5. Task 与 Candidate

只有异步、可取消或可重试的动作创建 GenerationTask。Task 固定用户、Project、目标、scope、base revision、context snapshot、Provider、模型、幂等键、Planner trace 和尝试记录；同一会话只允许一个活动任务。任务阶段由运行时真实状态映射，不作为 LCD 内容。

模型输出先经过 Zod、业务规则、Capability 和 LCD 校验。成功输出记录为 Candidate，至少包含目标、摘要、base revision、来源 Task、固定输入/输出引用、受约束操作和生命周期。资产图生成创建新的暂存 `AssetVersion`，确认保存前不会进入资产空间。

结构化模型输出首次不符合契约时允许按原 schema 自动修复一次，仍不合法则失败且不保存结果。失败卡按失败阶段重试：交互决策失败复用原始用户 Turn 和上下文重新规划，生成任务失败则使用已持久化的 Task 输入创建新尝试，不能把交互失败伪装成未登记的任务类型。

P0 每个 Task 只产生一个 Candidate，不提供多方案、并排比较或 stale 一键重生成。单格图片 Candidate 先进入只读的“候选图片预览”：画布仅把 Candidate 操作投影到当前可见页中的目标画格，不提交 ChangeSet；目标不在当前可见页时提示其 Page 范围，不静默切页或改绑。任务完成时若用户仍在目标页且没有打开其他候选预览，工作台自动进入预览；手动点击“预览”也直接展示候选图，两种入口的切换按钮都初始显示“还原”。目标画格、黄色边框、操作条与最终应用必须锁定同一个 Candidate 目标，目标或操作不一致时拒绝应用。目标画格下方固定显示横向操作条；用户可用同一按钮切换候选图与工作稿原图，选择应用时仍经过正常 revision 校验，取消只退出预览且不终结 Candidate。单格图片的目标标签同时包含 Page 范围与页内画格编号，避免不同页面的“画格 01”混淆。单格分镜条目 Candidate 可应用或丢弃；资产 Candidate 可保存到资产或丢弃；已应用结果仍可通过普通撤销路径回退，恢复到较早的保存版本时被移除的 Candidate 同步进入已回退状态。候选派生和多方案比较在 P1 完成。

## 6. 分阶段交付

### P0：可运行的对话 Agent

- 通用 Agent Loop、结构化语义 Planner、版本化 Prompt Package、Tool Registry、Observation 和 checkpoint。
- 直接回复、图片理解、追问与异步执行；同一 Turn 原位呈现任务、失败、取消和 Candidate。
- Context v1 与任务 snapshot；范围、选择和显式引用固定到执行输入。
- 开放单一明确目标画格的分镜条目创建/编辑、格内图片生成/替换，以及角色/场景资产图生成；画格目标可由选择、引用或当前页唯一语义定位。整页、整话、多方案、对白和编排不创建 Agent Task。格内图片任务只替换或放入目标画格的主图，不能降级为分镜条目编辑。
- 单格候选应用/丢弃、资产候选保存/丢弃，以及取消、失败重试、刷新恢复和 revision 冲突保护。

验收需覆盖文字模型与图片模型、直接回复/等待补充/异步执行、任务生命周期和 Candidate 全部终态；任何失败路径都不得改变工作稿。

### P1：动态上下文与复杂精修

- Capability 声明上下文需求，按目标动态检索相邻叙事、角色、场景、风格和连续性事实。
- 选区、遮罩、扩图、局部重画、对白差异比较、候选派生和多个可比较方案。
- MCP Server 开放只读上下文、工具查询/dry-run、任务生命周期、外部资源版本登记和 Candidate 暂存。
- 建立目标识别、越界率、无效追问、上下文命中、Candidate 应用率和 stale 率评估。

### P2：多 Agent 与 Workflow

- 聚焦精修模式锁定目标、保护范围和比较基线，支持跨多轮候选链。
- 持久 Workflow Run 编排普通 Task 和 Candidate，支持暂停、恢复、取消、检查点重规划和阶段确认。
- 仅在职责有独立输入输出和评估标准时调度专用子 Agent；子 Agent 仍使用同一 Tool Registry 和权限。
- 发布版本化 Lantern Skill，供 Codex 等外置 Agent 复用 Context、Task 和 Candidate 协议。

## 7. 外置 Agent 与运行规范

Lantern MCP Server 是外置 Agent 的首要接入面。它只暴露版本化语义工具：读取受范围约束的上下文、查询工具契约、创建/查询/取消 Task、登记外部生成资源，以及创建或管理 Candidate。MCP 不暴露 Prisma、对象存储凭证、任意 LCD 写入或原始 `WorkspaceCommand`；应用 Candidate 仍经过 Lantern 的用户确认、权限和 revision 校验。

Lantern Skill 只描述对象语义、范围判断和标准协作方式，不复制工具 schema，也不拥有权限。内置与外置 Agent 都要记录 actor、客户端、工具版本、决策、scope、context snapshot、工具调用、校验和最终 revision；日志不保存思维链或不必要的私有内容。

## 8. 漫画编辑与 Agent 能力矩阵

本表保留编辑能力全景，只在“Agent 工具”列标记当前可由 Agent 调用的能力；`—` 表示本阶段未开放，不评价底层工具是否已经存在。

| 阶段 | 大类 | 创作能力 | 格式 | 协议与实现路径 | 当前用户入口 | Agent 工具 |
|---|---|---|---|---|---|---|
| 核心 | 基础组织 | 创建、编辑和删除漫画与章节 | 通用 | `Comic / Chapter / Project` 持久化操作 | 已接入 | — |
| 核心 | 基础组织 | 新增、命名和删除页面或滚动段，并修改滚动段比例 | 通用 | `PresentationUnit`；现有页面 Capability 组合 | 已接入 | — |
| 核心 | 基础组织 | 复制当前页面或滚动段，并上移、下移展示单元 | 通用 | `reading.unitOrder` 与展示单元深度复制、ID 重映射 | 已接入 | — |
| 核心 | 画格编排 | 新增、删除、复制、移动、缩放和编辑常规矩形画格 | 通用 | `Frame.geometry / border / readingSequence`；画格属性与分镜绑定独立编辑，并保持一次原子变更 | 已接入 | — |
| 核心 | 画格编排 | 使用少量布局预设快速形成页面骨架 | 通用 | 1-6 格常用模板形成一次原子结构变更 | 未接入 | — |
| 核心 | 分镜 | 为每格创建和编辑画面描述 | 通用 | `StoryboardBeat / Frame.storyRefs` | 已接入 | 创建/编辑当前页唯一目标画格的分镜条目 Candidate |
| 核心 | 格内图片 | 把上传图片或已有资产放入指定画格 | 通用 | `ResourceRef + ImageElement` 作为一次受控放置，并支持更换或移除实例 | 已接入 | — |
| 核心 | 格内图片 | 调整格内图片取景 | 通用 | `ImageElement.crop`；平移、缩放、裁切和重置 | 已接入 | — |
| 核心 | 对白与气泡 | 新增、编辑和删除普通对白气泡 | 通用 | `Dialogue + BalloonElement` 作为一个复合能力 | 已接入 | — |
| 核心 | 对白与气泡 | 调整气泡位置、尺寸、旋转、尾巴和基础样式 | 通用 | `BalloonElement.transform / tailTarget / shape / cutCorners / style`；支持基础形状、稳定不规则的无尾切角八边形、横竖排、自动换行换列、字号和边框粗细 | 已接入 | — |
| 核心 | 资产与一致性 | 上传、摆放、整理和复用人物、场景与风格图片 | 通用 | `AssetVersion / ReferencePlacement / context snapshot` | 已接入 | 创建角色/场景 Candidate |
| 核心 | 版本与输出 | 保存、预览、应用、撤销、重做和恢复最近保存版本 | 通用 | `ChangeSet / Candidate / Undo / Snapshot`；恢复保存版本产生新的工作稿 revision | 已接入 | Candidate 查看、单格图片临时预览/还原、应用、丢弃与撤回 |
| 核心 | 版本与输出 | 页漫单页/双页预览、条漫连续预览、最近保存快照的当前范围 PNG 和 LCD 下载 | 通用 | LCD 与固定资源版本的确定性渲染和导出 | 已接入 | — |
| 增强 | 画格编排 | 显式允许叠格、取消叠格并调整画格前后层级 | 通用 | `layoutPolicy.frameOverlap / Frame.zIndex`；视觉层级与 `readingSequence` 独立 | 已接入 | — |
| 增强 | 画格表现 | 使用四角斜切、无框、线宽、圆角、基础形状、出血、整页主视觉和局部断框 | 通用 | `Frame.border / shape / mask / geometry / bleedEdges`；四角斜切使用轴向锁定的四边形和包围盒重算，出血按边延伸至所属 surface 并省略页边框，局部断框由出格对象或遮罩覆盖 | 部分接入：四角斜切、线宽与按边出血 | — |
| 增强 | 页面合成 | 让图片与气泡破格、跨格显示，并调整置顶、置底层级 | 通用 | Frame 锚定的 `UnitOverlay`；设为破格、转为纸面对象和收回画格保持视觉位置且可逆；普通 `TextElement` 本身属于跨格对象，不另设破格模式 | 已接入：图片与对白可破格、转纸面、收回、置顶和置底 | — |
| 增强 | 页面合成 | 创建和编辑无格图、纸面对白、旁白与装饰 | 通用 | Unit 锚定的 `UnitOverlay`；与无框 Frame 明确区分 | 已接入无格图、纸面对白和置顶纸面旁白 | — |
| 增强 | 文字 | 使用旁白、说明字和无气泡对白 | 通用 | 统一使用无 surface 约束的 `narration` TextElement；文案语义由内容和使用位置区分，不为说明字或无气泡对白另设对象类型 | 已接入：可创建、编辑、移动、缩放换行区域、旋转、复制和删除 | — |
| 增强 | 对白与气泡 | 使用喊叫、低声和电子声等表现型气泡 | 通用 | `Dialogue / BalloonElement` 保留语义与可编辑参数，`appearance` 引用固定版本的图像外观；三端按同一规则渲染 | 部分接入：协议与基础形状可用，外观入口未接入 | — |
| 增强 | 阅读节奏 | 调整画格与气泡阅读顺序 | 通用 | `readingSequence / textOrder`；只提供编号与前移/后移 | 未接入 | — |
| 增强 | 阅读节奏 | 增加留白、重复节奏和场景停顿 | 通用 | 调整画格几何与空白区域；条漫同步调整纵向空间 | 未接入 | — |
| 增强 | 画内效果 | 添加速度线、集中线、冲击、光影和天气效果 | 通用 | 确定性工具或图像处理产出透明效果资产；复杂效果可选用修图模型融合，均形成新 `AssetVersion` | 未接入 | — |
| 增强 | 画内效果 | 添加具有漫画感的拟声字 | 通用 | `TextElement` 保留文字语义；普通样式直接渲染，复杂变形通过 `appearance` 引用固定图像版本，改字时重新生成外观资源 | 部分接入：协议与渲染可用，创建编辑入口未接入 | — |
| 后置 | 专业编排 | 画格拆分合并、复杂异形格和自由嵌套 | 通用 | 专业结构编辑，不作为普通创作者的前置能力 | 未接入 | — |
| 后置 | 专业合成 | 完整图层面板、锁定、混合模式和跨层搬移 | 通用 | 专业图层编辑 | 未接入 | — |
| 后置 | 页漫专项 | 单双页合并拆分、装订缝，以及图片、画格和气泡跨页 | 页漫 | 真正双页共享 `PresentationUnit`；跨页格使用 `surfaceScope: unit`，跨页图片和气泡进入 `cross_page` 覆盖层，`PageSurface` 分别裁切 | 已接入；按边出血已接入，安全区辅助仍未接入 | — |
| 后置 | 条漫专项 | 滚动段合并拆分、跨段约束和跨段图片 | 条漫 | 复合滚动段共享 `PresentationUnit`；各 segment 仍是独立输出面 | 已接入；段间距和平台切片仍未接入 | — |
| AI 专属 | 布局候选 | 根据分镜生成页面布局候选 | 通用 | 混合：模型规划布局意图，确定性布局器生成结构 Candidate | — | — |
| AI 专属 | 格内图片 | 根据单格描述、人物、场景和风格引用生成成稿 | 通用 | 混合：固定引用进入上下文，模型生成新 `AssetVersion`，局部候选放入或替换 | 已接入 | 生成/替换当前页唯一目标画格的格内图片 Candidate |
| AI 专属 | 格内图片 | 对指定格进行整格精修 | 通用 | 修图模型处理指定格或格内图片，生成新 `AssetVersion` | 未接入 | — |
| AI 专属 | 对白与气泡 | 自动润色、压缩或改写指定对白 | 通用 | 文本模型返回局部文字候选，确认后复用确定性更新 | 未接入 | — |
