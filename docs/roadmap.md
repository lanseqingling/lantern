# 迭代路线

> 性质：临时治理与收口清单，不是长期事实源
> 日期：2026-07-14
> 退出条件：本文所有未决项都已进入正式文档、实现与验证后，删除本文及所有入口
> 事实优先级：产品规则以正式事实源为准；当前字段、命令和运行行为以可执行 schema 与代码为准；本文只记录两者之间的差额
> 同步要求：新增、删除或调整漫画编辑能力，或改变用户入口、Agent Capability 登记与权限时，必须同步更新文末“漫画编辑能力矩阵”

## 0. 本文如何使用和删除

本文只承担从早期 Agent MVP 设想到稳定日常迭代之间的**差额清单**。它允许出现 E0、A0、旧 P0 等阶段词，因为这些词只用于识别待治理内容；正式产品文档与实现不应继续用开发阶段命名。

每次治理遵循同一个动作：

1. 对一个未决项作出产品或技术决定。
2. 把最终规则写入唯一正式事实源，并完成对应实现与验证。
3. 删除该项的待办、旧判断、实施细节和小标题，保留主章节标题与一句完成结果。
4. 不记录完成日期、过程或变更清单；详细过程仍由 Git 历史追溯。

各部分的最终去向与收口方式如下：

| 本文部分 | 最终去向 | 完成后在本文的状态 |
|---|---|---|
| 1 执行优先级 | 对应正式事实源 | 保留已完成优先级的名称与一句结果 |
| 2 产品事实 | 产品概要、PRD | 保留章节标题与一句结果 |
| 3 文档治理 | 各正式文档 | 保留章节标题与一句结果 |
| 4 代码治理 | 代码、测试与脚本 | 保留章节标题与一句结果 |
| 5-7 编辑器能力 | 编辑器体验、LCD、代码与测试 | 删除具体待办，保留章节标题与一句结果 |
| 8 工具治理 | Capability Registry、领域执行器 | 删除具体待办，保留章节标题与一句结果 |
| 9 Agent | Agent 设计与运行代码 | 删除具体待办，保留章节标题与一句结果 |
| 10 方向问题 | 对应正式事实源 | 删除问题明细，保留章节标题与一句结果 |

当最后一个未决项完成时，同时删除本文和 `docs/README.md` 中的入口。这表示最初设想的 Agent MVP 已经由更完整的编辑器与受控 Agent 闭环替代，而不是停止继续迭代。

## 1. 剩余执行优先级

已完成：产品事实源与文档收口；阶段命名和低风险代码整理；编辑、预览与导出渲染一致性基线。

| 优先级 | 工作 | 为什么先做 | 完成标志 |
|---|---|---|---|
| 4 | 人类结构编辑与合成能力 | 这是作品可控和未来 Agent 可控的共同基础 | 页面、画格、气泡、层级、阅读顺序具备 UI、Undo 和测试 |
| 5 | 页漫与条漫格式专项 | 在共享对象能力稳定后补格式差异，避免各做一套编辑器 | 页漫可完成真实作品；条漫具备手机预览和切片闭环 |
| 6 | Capability Registry 与领域工具收口 | 把已有能力变成 Agent 能被允许调用的执行事实源 | UI 和 Agent 引用同一 capability id 与执行器 |
| 7 | Agent 观察、预览和受控执行 | 最后接入模型，避免模型放大尚未确定的作品语义 | 低风险对象/单页案例可解释、可预览、可应用和撤销 |

## 2. 产品事实与早期设计遗留

已完成：产品定位、目标用户、用户掌控和格式优先级已收口；同源能力、上下文优先、可预测执行和候选确认已进入正式事实源。

## 3. 正式文档治理

已完成：文档已收敛为六类入口，重复与过期设计稿已移除，正式文档直接描述当前规则与验收。

## 4. 代码与组件治理

已完成：阶段命名和历史界面残留已清理，生产与演示边界、编辑器模块、工作台组件和服务职责已收口。

## 5. 编辑器基线与差距

已完成：现有可视能力已收口到共享场景投影，工作台、预览与导出由同一层级、可见性、坐标和裁切语义约束；能力状态和后续缺口统一由文末漫画编辑能力矩阵维护。

## 6. 页漫与条漫能力范围

本节不要求 Lantern 复制专业绘图软件，而是提取结构化漫画编辑必须具备的语义。

调研依据包括 Clip Studio Paint 官方的[画格能力](https://help.clip-studio.com/en-us/manual_en/540_comic/Frames_and_Panels.htm)、[气泡能力](https://help.clip-studio.com/en-us/manual_en/540_comic/Balloons.htm)、[多页管理](https://help.clip-studio.com/en-us/manual_en/570_pages/Page_Manager.htm)、[纸面与出血](https://help.clip-studio.com/en-us/manual_en/210_file/Creating_a_New_Canvas.htm)和[条漫工具](https://help.clip-studio.com/en-us/manual_en/540_comic/Webtoons.htm)，以及 WEBTOON 的[发布前预览流程](https://webtooncanvas.zendesk.com/hc/en-us/articles/18556588863380-How-do-I-start-publishing-on-CANVAS)。

### 6.1 页漫

1. 页面新增、删除、复制、重排，以及单页与真正双页的合并/拆分。
2. 内框、裁切、出血、安全区、左右页和装订缝辅助。
3. 画格新增、删除、复制、拆分、合并、吸附和对齐。
4. 边框粗细、无框、圆角、形状、遮罩、重叠和层级。
5. 格内图、对白、效果，以及人物破框、跨格物体、页面大图和跨页图。
6. 对白、思考、旁白、无框旁白、拟声字及其阅读顺序。
7. 画格/气泡顺序、双页方向、首末页位置、预览与导出一致性检查。

### 6.2 条漫

1. 长画布或条漫段的插入、删除、重排和高度调整。
2. 把画格间空白作为节奏对象独立调整。
3. 手机可视区遮罩/预览，检查一屏格数、对白密度和悬念停顿。
4. 支持背景、对白和效果跨格或位于画格间空白。
5. 连续长图预览与按平台规则非破坏性切片。
6. 纵向画格和对白阅读顺序校验。

笔刷、矢量线稿、3D、网点、复杂混合模式、印刷色彩管理和多人协作不是 Agent 迭代前置条件。

## 7. 人类编辑能力实施顺序

### 7.1 结构编辑

1. 新增、删除、复制画格。
2. 拆分画格；随后补合并及内容保留规则。
3. 原子新增、删除、复制对白与气泡。
4. 显式调整画格与气泡阅读顺序。
5. 页面复制和重排。
6. 统一选择、菜单、快捷操作、Undo/Redo 和删除确认。

`packages/shared/src/workspace.ts` 至少补齐 `add_dialogue_balloon`、`remove_dialogue_balloon`、`split_frame`、`set_frame_reading_order`、`duplicate_presentation_unit` 和 `reorder_presentation_unit`。

### 7.2 层级、无框与破框

- 画格样式：有框/无框、线宽、圆角、矩形/多边形/椭圆。
- 对象层级：上移、下移、置顶、置底、显示、隐藏、锁定。
- 合成范围：格内、破框、跨格/页面、跨页；界面用“移出画格/收回画格”表达范围变化。
- 页面大图使用展示单元覆盖层或覆盖纸面的画格，不做界面特例。
- 跨页对象属于双页共同坐标空间，不复制到两页。

协议需要覆盖层与元素的增删和排序，以及格内图层与展示单元覆盖层之间保持锚点的双向转换。转换必须可逆并保持视觉位置。

### 7.3 格式闭环

页漫补纸面辅助线、出血/安全区、单双页合并拆分、装订缝和跨页预览。条漫补滚动段重排、段间距、跨段约束和切片导出。页面方案和历史快照继续作用于现有展示结构，不另建条漫版本机制。

## 8. 统一领域工具治理

### 8.1 三层工具

| 层 | 作用 | 示例 |
|---|---|---|
| 原子命令 | 单一、确定性领域写入 | `move_frame`、`update_dialogue` |
| 复合编辑工具 | 多个命令组成一次事务和一次 Undo | 新增气泡、拆分画格、形成破框 |
| 生成工具 | 调模型或算法，产出资产/方案，不直接覆盖作品 | 生成格内图、建议编排、重写对白 |

人类 UI 通常调用复合工具，Agent 也调用同一个复合工具。原子命令是协议构件，不要求全部直接暴露。

### 8.2 Capability Registry

```ts
type EditorCapability = {
  id: string
  version: number
  inputSchema: ZodSchema
  scope: "element" | "frame" | "unit" | "chapter"
  humanEntry: "available" | "planned" | "exception"
  agentAccess: "disabled" | "observe" | "preview" | "execute"
  risk: "low" | "medium" | "high"
  preconditions: string[]
  outputCommandTypes: WorkspaceCommand["type"][]
  previewPolicy: "inline" | "candidate" | "staged"
  undoPolicy: "atomic"
}
```

Registry 与 dry-run 位于 `packages/editor-core`，命令和 ChangeSet 的运行时 schema 位于 `packages/shared`。后续编辑能力直接扩充这一事实源，不在 API、UI 或 Agent 中复制 schema、ID 和业务默认值。

默认规则是 `agentAccess <= humanEntry`。AI-first 例外必须登记原因、输出边界、回退方式和未来人类入口。

低风险能力局限于当前对象、直接可见且一次 Undo 可恢复；改变当前页或多个对象必须展示计划和预览；跨页、整话、格式转换或批量删除必须分阶段候选。整组 replace 默认只用于导入、迁移、恢复或经过专门审查的方案应用。

## 9. Agent 放在编辑器之后

[Agent](./agent.md)维护稳定协作、上下文和安全边界。本节只跟踪尚未落地的 Capability Registry、领域执行器和受控执行路径；对应能力完成后直接更新正式文档，并把本节收短为一句完成结果。

### 9.1 旧 Agent 的问题

当前 [`packages/agent-runtime`](../packages/agent-runtime/) 按 storyboard、page_layout、frame_image、asset_parse、dialogue 任务类型组织。[`task-processor.ts`](../packages/agent-runtime/src/task-processor.ts) 中 Storyboard 直接形成整组 `replace_storyboard_beats`，Page Layout 直接形成整话 `replace_chapter_layout`，Frame Image 会构造完整 ComicDocument 再替换 presentation；[`orchestrator.ts`](../packages/agent-runtime/src/orchestrator.ts) 主要从文本判断任务与范围，而不是从统一能力表规划工具。

可以保留会话、消息、上下文快照、任务审计、候选、队列、Provider Adapter 和 revision 冲突保护；必须替换“任务类型直接产出大范围作品替换”的执行方式。现有请求边界集中在 [`apps/api/src/routes/agent.ts`](../apps/api/src/routes/agent.ts)。

### 9.2 目标交互与架构

Agent 最终只有四种模式：

1. 问答/建议：只读上下文，不创建作品任务。
2. 计划预览：输出工具计划、对象、顺序和影响范围，执行 dry-run。
3. 受控编辑：只运行允许的当前对象/当前页工具，结果成为 Candidate。
4. 分阶段创作：多页或多范围请求拆成有依赖的阶段，每阶段确认后继续。

```text
用户输入 + 当前选择 + 显式引用
  → Context Builder
  → Intent / Scope Resolver
  → Planner（只输出工具计划）
  → Capability Registry 权限与 schema 校验
  → Dry-run Executor + LCD Validator + Diff Summary
  → Candidate / Staged Candidates
  → 用户预览与应用
  → WorkspaceChangeSet → 新 WorkingRevision
```

模型不返回最终 ComicDocument，不生成任意命令名，不绕过确认。工具执行器负责 ID、默认值、坐标约束、事务、幂等和撤销。

### 9.3 典型案例

| 场景 | Agent 计划 | 最终效果 |
|---|---|---|
| 给当前格新增对白 | `add_dialogue_balloon` | 出现可调整气泡候选，只影响当前格 |
| 横向拆分画格 | `split_frame` + 内容分配策略 | 先显示拆分线与阅读序号，一次应用、一次撤销 |
| 角色破框 | promote 到 frame-anchored overlay + transform | 不复制素材，移动画格时仍跟随 |
| 开场跨页大图 | 合并 spread，再放置跨页图并迁移对白 | 高风险分阶段确认，可中途停止 |
| 增加条漫停顿 | 调整 segment/gutter 并做手机视区 dry-run | 连续滚动候选，不改格内图 |
| 只重画一格 | 生成 AssetVersion + 局部替换 | 旧图保留，只替换指定元素引用 |

图片生成可作为 AI-first 例外，因为普通参数编辑无法替代生成；但应用动作仍必须是人类可执行的局部替换。

### 9.4 当前执行策略

在新工具链完成前，旧 AI 核心应**软封禁执行，不物理删除**：

```text
AGENT_EXECUTION_MODE=disabled | observe | tool_preview | enabled
```

- 正常产品环境关闭 storyboard、page_layout、frame_image、asset_parse、dialogue 模型任务。
- UI 保留会话管理和未来 Agent 入口，不宣称能可靠修改作品。
- 开发环境可使用 observe：构建上下文与计划，但不投递 Worker、不创建可应用 Candidate。
- 保留 Conversation/Message、Context Builder、context-debug、Task/Candidate 骨架、Provider、stale 检查、ChangeSet、WorkingRevision 和 SavedSnapshot。
- 旧 taskType 路由和直接生成大范围 replace 的处理器后续改造或降级为测试夹具。
- Export 不是 AI，应逐步从 GenerationTask 语义中独立为确定性后台作业。

### 9.5 进入受控 Agent 的门槛

- 页面、画格、气泡结构动作都有同源工具、Undo 和测试。
- 无框、层级和 frame-anchored breakout 至少完成，三端渲染一致。
- Capability Registry 覆盖首批案例，allowlist 只开放当前对象/当前页。
- Agent 能解释读取的上下文、计划工具和影响对象。
- dry-run 能在不写数据库时得到校验结果、视觉预览和变更摘要。
- 旧 Agent 执行保持 disabled/observe，不能与新执行器并存为两套主路径。

## 10. 仍需确认的方向问题

这些问题决定后，把结论写入产品概要、PRD、交互稿、LCD 或 Agent 设计，删除问题明细；全部决定后，本节只保留一句完成结果。

1. 首批 Agent 是否限定当前页/当前选择，明确不创建整话、不自动跨页？建议是。
2. 图片生成/局部修图是否作为首批 AI-first 例外？建议接受，但只能产出 AssetVersion 和局部替换候选。

## 11. 删除本文的最终检查

删除前只检查结果，不展开过程总结：

- 产品概要已包含同源编辑能力和可预测 Agent 原则。
- PRD、交互稿、Design System、LCD、Agent 设计直接描述当前产品，不依赖阶段修正关系。
- 人类编辑能力、Capability Registry、Agent allowlist、预览/导出和 Undo 使用同一套领域语义。
- 旧任务型 Agent 不再是可执行主路径；典型案例能计划、预览、应用、撤销和恢复。
- 本文中的方向问题均已进入正式事实源或被明确排除。

满足后删除本文以及 `docs/README.md` 中的入口。以后新增能力直接走日常 PRD、协议和代码迭代，不再创建新的“下一阶段说明”。

## 附录：漫画编辑能力矩阵

本表同时记录当前状态和完整 MVP 目标，不把底层字段或命令数量等同于用户能力。`核心` 约覆盖常见页面创作的 50%-60%；`增强` 将覆盖推进到约 70%-80%；`后置` 不阻塞 MVP；`需判断` 表示效果重要，但是否扩协议仍需产品决定。状态以 [`packages/shared/src/lcd/`](../packages/shared/src/lcd/)、[`workspace-schema.ts`](../packages/shared/src/workspace-schema.ts)、[`capabilities.ts`](../packages/editor-core/src/capabilities.ts) 和实际入口为准。

- `结构`表示由 LCD 和确定性 Capability 持续编辑；`混合`表示结构化限定范围后，由模型或图像 SDK 产出可预览 Candidate；`图像`表示效果进入新的 AssetVersion 或透明效果资产，不为每种画内效果增加协议类型。
- `已接入`、`部分接入`、`未接入`描述当前用户入口。`已登记（禁用）`表示 Capability 已存在但 Agent 尚不可调用；当前没有任何漫画编辑 Capability 对 Agent 开放执行。
- AI 不直接生成或覆盖整页 LCD。布局只生成少量结构候选，生成和精修只替换指定资源版本，所有结果均可比较、拒绝和撤销。

| 阶段 | 大类 | 创作能力 | 格式 | 协议与实现路径 | 当前用户入口 | Agent 工具 |
|---|---|---|---|---|---|---|
| 核心 | 基础组织 | 创建、编辑和删除漫画与章节 | 通用 | `Comic / Chapter / Project` 持久化操作 | 已接入 | 未登记 |
| 核心 | 基础组织 | 新增、命名和删除页面或滚动段，并修改滚动段比例 | 通用 | `PresentationUnit`；现有页面 Capability 组合 | 已接入 | 4 项已登记（禁用） |
| 核心 | 画格编排 | 用常规矩形画格完成清晰分镜 | 通用 | `Frame.geometry / readingSequence`；画格增删、移动、缩放和基础间距 | 部分接入：仅移动、缩放 | 未登记 |
| 核心 | 画格编排 | 使用少量布局预设快速形成页面骨架 | 通用 | 1-6 格常用模板形成一次原子结构变更 | 未接入 | 未登记 |
| 核心 | 分镜 | 为每格创建和编辑画面描述 | 通用 | `StoryboardBeat / Frame.storyRefs` | 已接入 | 2 项已登记（禁用） |
| 核心 | 格内图片 | 把上传图片或已有资产放入指定画格 | 通用 | `ResourceRef + ImageElement` 作为一次受控放置 | 未接入 | 未登记 |
| 核心 | 格内图片 | 根据单格描述、人物、场景和风格引用生成成稿 | 通用 | 混合：固定引用进入上下文，模型生成新 `AssetVersion`，局部候选替换 | 部分接入：旧任务与引用选择分离 | 未登记 |
| 核心 | 格内图片 | 对指定格进行重画、扩图或局部精修 | 通用 | 混合：修图模型或 SDK 只处理当前格与选区，生成新 `AssetVersion` | 部分接入：旧任务仅支持整格 | 未登记 |
| 核心 | 格内图片 | 调整格内图片取景 | 通用 | `ImageElement.crop`；平移、缩放、裁切和重置 | 已接入 | `set_art_crop`（已登记，禁用） |
| 核心 | 对白与气泡 | 新增、编辑和删除普通对白气泡 | 通用 | `Dialogue + BalloonElement` 作为一个复合能力 | 部分接入：仅编辑现有对白 | 仅 `update_dialogue` 已登记（禁用） |
| 核心 | 对白与气泡 | 调整气泡位置、尺寸、尾巴和基础样式 | 通用 | `BalloonElement.transform / tailTarget / shape / style`；只提供少量预设 | 已接入 | 未登记 |
| 核心 | 资产与一致性 | 上传、摆放、整理和复用人物、场景与风格参考 | 通用 | `AssetVersion / ReferencePlacement / context snapshot` | 已接入 | 不适用：作为生成上下文 |
| 核心 | 版本与输出 | 保存、预览、应用、撤销和恢复一次创作结果 | 通用 | `ChangeSet / Candidate / Undo / Snapshot` | 已接入 | 不适用 |
| 核心 | 版本与输出 | 页漫单页/双页预览、条漫连续预览、最近保存快照的当前范围 PNG 和 LCD 下载 | 通用 | LCD 与固定资源版本的确定性渲染和导出 | 已接入 | 不适用 |
| 增强 | 基础组织 | 复制和重排页面或滚动段 | 通用 | `reading.unitOrder` 与展示单元复制、ID 重映射 | 未接入 | 未登记 |
| 增强 | 画格编排 | 根据分镜生成 2-3 个页面布局候选 | 通用 | 混合：模型规划布局意图，确定性布局器生成结构 Candidate | 部分接入：旧任务直接替换大范围文档 | 未登记 |
| 增强 | 画格表现 | 使用无框、出血、整页主视觉和局部断框 | 通用 | `Frame.border / mask / geometry` 的简单预设；局部断框由出格对象或遮罩覆盖，不扩协议 | 未接入 | 未登记 |
| 增强 | 页面合成 | 让人物或物体出格、跨格显示 | 通用 | `UnitOverlay` 使用 Frame 锚点，不开放完整图层软件 | 未接入 | 未登记 |
| 增强 | 文字 | 使用旁白、说明字和无气泡对白 | 通用 | `TextElement` 位于格内或页面覆盖层 | 未接入 | 未登记 |
| 增强 | 对白与气泡 | 自动润色、压缩或改写指定对白 | 通用 | 混合：文本模型返回局部文字候选，确认后复用确定性更新 | 未接入 | 未登记 |
| 增强 | 对白与气泡 | 使用喊叫、低声和电子声等表现型气泡 | 通用 | `Dialogue / BalloonElement` 保留语义与可编辑参数，`appearance` 引用固定版本的图像外观；三端按同一规则渲染 | 部分接入：协议与基础形状可用，外观入口未接入 | `set_element_appearance`（已登记，禁用） |
| 增强 | 阅读节奏 | 调整画格与气泡阅读顺序 | 通用 | `readingSequence / textOrder`；只提供编号与前移/后移 | 未接入 | 未登记 |
| 增强 | 阅读节奏 | 增加留白、重复节奏和场景停顿 | 通用 | 调整画格几何与空白区域；条漫同步调整纵向空间 | 未接入 | 未登记 |
| 增强 | 画内效果 | 添加速度线、集中线、冲击、光影和天气效果 | 通用 | 混合：确定性 SDK 生成速度线、集中线、网点等透明效果资产；修图模型处理复杂光影、天气和画面融合，均形成新 `AssetVersion` | 未接入 | 未登记 |
| 增强 | 画内效果 | 添加具有漫画感的拟声字 | 通用 | `TextElement` 保留文字语义；普通样式直接渲染，复杂变形通过 `appearance` 引用固定图像版本，改字时重新生成外观资源 | 部分接入：协议与渲染可用，创建编辑入口未接入 | `set_element_appearance`（已登记，禁用） |
| 后置 | 专业编排 | 画格拆分合并、复杂异形格和自由嵌套 | 通用 | 专业结构编辑，不作为普通创作者的前置能力 | 未接入 | 未登记 |
| 后置 | 专业合成 | 完整图层面板、锁定、混合模式和跨层搬移 | 通用 | 专业图层编辑 | 未接入 | 未登记 |
| 后置 | 页漫专项 | 真正双页、印刷安全区和复杂跨页对象 | 页漫 | `spread / PageSurface / UnitOverlay` 的格式专项能力 | 未接入 | 未登记 |
| 后置 | 条漫专项 | 平台规则切片和复杂跨段对象 | 条漫 | 格式专项结构与输出 | 未接入 | 未登记 |
| 需判断 | 条漫专项 | 跨滚动段的连续背景或特效 | 条漫 | 当前覆盖层限于单段；MVP 使用更长滚动段或切分同一资产，刚需明确后再扩章节级覆盖层 | 未接入 | 未登记 |
