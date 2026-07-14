# 迭代路线

> 性质：临时治理与收口清单，不是长期事实源
> 日期：2026-07-14
> 退出条件：本文所有未决项都已进入正式文档、实现与验证后，删除本文及所有入口
> 事实优先级：产品规则以正式事实源为准；当前字段、命令和运行行为以可执行 schema 与代码为准；本文只记录两者之间的差额

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

已完成：产品事实源与文档收口；阶段命名和低风险代码整理。

| 优先级 | 工作 | 为什么先做 | 完成标志 |
|---|---|---|---|
| 3 | 编辑、预览、导出渲染一致 | 新增无框、破框、跨页前必须保证同一 LCD 在三个出口一致 | 同一 fixture 的对象、层级、裁切和边框呈现一致 |
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

### 5.1 已有可保留基础

- LCD 已分开 `StoryboardBeat`、`PresentationUnit / PageSurface / Frame`、图层元素、资源、对白和运行时状态，协议入口见 [`packages/shared/src/lcd/`](../packages/shared/src/lcd/)。
- `WorkspaceCommand` 使用有限写入词汇，不使用任意 JSON Patch；命令与 ChangeSet 定义见 [`packages/shared/src/workspace.ts`](../packages/shared/src/workspace.ts)，确定性执行见 [`packages/editor-core/src/index.ts`](../packages/editor-core/src/index.ts)。
- WorkingRevision、SavedSnapshot、Candidate、ChangeSet、会话与任务已有持久化边界，服务读写集中在 [`packages/server/src/workbench-service.ts`](../packages/server/src/workbench-service.ts)。
- 画布已有画格移动/缩放、格内图裁切、气泡移动/缩放/尾巴/样式/对白、单格画面编辑、参考资产和多选。
- 预览、保存、导出读取 LCD，不以聊天记录或画布临时状态为作品事实。
- `context-debug` 能重新计算真实上下文，可保留为后续 Agent 调试入口；请求边界见 [`apps/api/src/routes/workbench.ts`](../apps/api/src/routes/workbench.ts)。

### 5.2 协议与人类入口差距

| 能力 | LCD / Command | 当前入口 | 主要缺口 |
|---|---|---|---|
| 页面 / 展示单元 | 有 single、spread、vertical、four-panel 和新增命令 | 可新增空白页、切换查看 | 删除、复制、重排、单双页合并/拆分、条漫段管理 |
| 画格 | 有形状、边框、遮罩、zIndex、add/remove/style/reorder | 移动、缩放、裁切、编辑分镜 | 新增、删除、复制、拆分、合并、无框、层级和阅读顺序 UI |
| 气泡 / 对白 | 两者分离；有 update 命令 | 可改字、形状、位置、尺寸和尾巴 | 原子新增/删除、复制、顺序、跨格/页面放置 |
| Frame 图层 | 有 art/text/effect、显示、锁定、overflow、zIndex | 无统一入口 | 图层增删、显隐、锁定、排序和元素跨层移动 |
| Unit Overlay | 有 frame/unit anchor 和 breakout/cross-frame/cross-page | 无 | 渲染、选择、写入命令和编辑 UI |
| 文字与效果 | 有 caption/narration/sfx 和效果类型 | 基本无 | 工作台渲染与编辑未闭环 |
| 阅读顺序 | 有 `readingSequence` | 只显示编号 | 显式改序、文本顺序和格式校验 |
| 纸面规则 | 有 trim/bleed 和左右页角色 | 无辅助入口 | 内框、安全区、装订缝、跨页预览和导出检查 |

### 5.3 先解决三端渲染一致性

当前 [`ComicRenderer`](../app/components/ComicRenderer.tsx) 主要覆盖格内图片、矩形画格和气泡，没有完整渲染普通文字、效果、非矩形 Frame 和 Unit Overlay；[`export-renderer`](../packages/server/src/export-renderer.ts) 与前端也未完全同源。

新增结构编辑前应：

- 建立共享的 LCD scene projection，统一层级顺序、overflow 和坐标转换。
- 补齐 Frame shape、border none、文字、效果和 Unit Overlay 渲染。
- 明确格内元素、frame-anchored overlay、unit-anchored overlay 的转换。
- 对同一 fixture 增加编辑、预览和导出 golden 测试。

验收标准是同一 WorkingRevision 在三个出口的对象数量、层级、裁切、可见性和边框一致。

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
5. 页面新增、删除、复制和重排。
6. 统一选择、菜单、快捷操作、Undo/Redo 和删除确认。

`packages/shared/src/workspace.ts` 至少补齐 `add_dialogue_balloon`、`remove_dialogue_balloon`、`split_frame`、`set_frame_reading_order`、`remove_presentation_unit`、`duplicate_presentation_unit` 和 `reorder_presentation_unit`。

### 7.2 层级、无框与破框

- 画格样式：有框/无框、线宽、圆角、矩形/多边形/椭圆。
- 对象层级：上移、下移、置顶、置底、显示、隐藏、锁定。
- 合成范围：格内、破框、跨格/页面、跨页；界面用“移出画格/收回画格”表达范围变化。
- 页面大图使用展示单元覆盖层或覆盖纸面的画格，不做界面特例。
- 跨页对象属于双页共同坐标空间，不复制到两页。

协议需要覆盖层与元素的增删和排序，以及格内图层与展示单元覆盖层之间保持锚点的双向转换。转换必须可逆并保持视觉位置。

### 7.3 格式闭环

页漫补纸面辅助线、出血/安全区、单双页合并拆分、装订缝和跨页预览。条漫补段高度、段间距、手机视区、跨段约束、连续预览和切片导出。页面方案和历史快照继续作用于现有展示结构，不另建条漫版本机制。

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
