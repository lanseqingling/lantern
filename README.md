<p align="center">
  <img src="./docs/images/readme/hero.png" width="100%" alt="Lantern AI：一盏灯，陪你打磨漫画故事">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-%E6%8C%81%E7%BB%AD%E5%BC%80%E5%8F%91%E4%B8%AD-F2B84B" alt="持续开发中">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/open%20source-MIT-2E8B57" alt="Open source under the MIT License"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-5B8DEF" alt="macOS and Windows">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.13-43853D" alt="Node.js 22.13 or newer">
</p>

<p align="center">
  <a href="https://github.com/lanseqingling/lantern/releases/latest">下载</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#当前能力状态">当前能力</a> ·
  <a href="./docs/README.md">文档</a> ·
  <a href="#通过-mcp-与-skill-接入外置-agent">MCP + Skill</a>
</p>

Lantern AI 是面向个人漫画创作者的 AI 漫画创作工作台。它把故事、角色、场景、分镜、页面编排、单格精修、预览与导出放在一个持续可编辑的创作空间中，并通过 MCP 与 Skill 让产品内外的 Agent 复用同一套创作能力与作品边界。

## 产品设计

Lantern 以 LCD 作品协议为基础，在统一的漫画画布和受控编辑边界内支持创作者与 Agent 协作：

- LCD 作品协议：LCD 统一表达页面、画格、图层、格内内容和固定资产版本，工作台、候选预览、阅读与导出共享同一份作品事实。

- 漫画画布：页面或滚动段位于工作台中央，资产、分镜、参考图片和 Agent 对话围绕作品展开；参考图片只有明确放入画格或纸面后才进入成稿。

- 受控编辑：UI 与产品内外的 Agent 共用语义能力和作品边界；普通编辑可撤销，生成、结构和多对象结果先形成 Candidate，由创作者决定是否应用。

```text
qu工作台 / 内置 Agent / 外置 Agent（MCP + Skill）
                ↓
          受控语义能力
                ↓
      可撤销工作稿或待确认 Candidate
                ↓
             LCD 作品
                ↓
          预览、保存与导出
```

<p align="center">
  <img src="./docs/images/readme/workbench-overview.png" width="100%" alt="Lantern AI 漫画工作台主界面">
</p>

<p align="center"><sub>漫画编排与 Agent 协作工作台</sub></p>

## 当前能力状态

`✅` 已接入　`🟡` 部分接入　`❌` 未接入　`⚪` 不涉及

| 能力 | UI 编辑器 | MCP | 内置 Agent |
|---|:---:|:---:|:---:|
| 漫画、一话与故事设定管理 | ✅ | ✅ | ❌ |
| 资产卡、漫画封面、视觉风格与多图片管理 | ✅ | ✅ | ❌ |
| 页漫正文、封面、过场与真正双页管理 | ✅ | ✅ | ❌ |
| 条漫滚动段与跨段编排 | ✅ | ❌ | ❌ |
| 画格创建、边框、层级、出血与阅读顺序 | ✅ | ✅ | ❌ |
| 外部图片上传与固定版本登记 | ✅ | ✅ | ❌ |
| 格内、纸面图片放置、裁切与有限破格 | ✅ | ✅ | 🟡 |
| 单格分镜条目创建与编辑 | ✅ | ❌ | ✅ |
| 对白、气泡、旁白与基础文字编排 | ✅ | ✅ | ❌ |
| 固定原图、当前工作稿与最近保存页面的只读观察 | ⚪ | ✅ | 🟡 |
| 单页构图与人物/场景/风格一致性检查 | ⚪ | ✅ | ❌ |
| 相邻分镜连续性与创作表达检查 | ⚪ | ✅ | ❌ |
| 格内图片、角色与场景资产生成 | ✅ | ⚪ | ✅ |
| Candidate 查看、应用与冲突保护 | ✅ | 🟡 | ✅ |
| 阅读预览、图片下载与 LCD 导入导出 | ✅ | ❌ | ❌ |
| 画内效果与表现型气泡 | 🟡 | ❌ | ❌ |
| 选区、遮罩、局部重画与扩图 | ❌ | ❌ | ❌ |
| 页面布局、多页与多对象生成 | ❌ | ❌ | ❌ |
| 漫画解析与可复用模板制作 | ❌ | ❌ | ❌ |

表格只展示当前入口覆盖情况；`⚪` 表示该入口按职责不承担，不应计入待补齐能力。具体拆分、范围和三端差异见[漫画能力矩阵](./docs/capabilities.md)。

## 快速开始

> 需要带 npm 的 Node.js 22.13 或更高版本。当前发行验收覆盖 macOS 和 Windows。

推荐从 [GitHub Releases](https://github.com/lanseqingling/lantern/releases/latest) 下载 `lantern-<version>-source.zip` 和同版本的 `SHA256SUMS`。也可以直接获取源码：

```bash
git clone https://github.com/lanseqingling/lantern.git
cd lantern
```

在解压或克隆后的目录中启动：

```bash
npm start
```

首次启动会准备锁定依赖并初始化本地数据。工作台默认打开 [http://localhost:18788](http://localhost:18788)。

<details>
<summary>校验下载的 Release 包</summary>

macOS：

```bash
shasum -a 256 -c SHA256SUMS
```

Windows PowerShell：

```powershell
$archive = Get-ChildItem .\lantern-*-source.zip | Select-Object -First 1
$expected = (Get-Content .\SHA256SUMS).Split()[0].ToLower()
$actual = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLower()
$actual -eq $expected
```

校验通过后再解压源码包。

</details>

## 通过 MCP 与 Skill 接入外置 Agent（推荐）

> 内置 Agent 暂不迭代，推荐通过 MCP + Skill 使用外置 Agent。

需要从兼容的本地 Agent 使用 Lantern 时，先启动 Lantern，再让该 Agent 在 Lantern 目录中运行：

```bash
./lantern agent:install
```

Windows 使用 `lantern.cmd agent:install`。命令会识别当前 Agent，安装 Lantern 应用级 Skill 并登记本地 MCP。Agent 只能使用 Lantern 当前显式开放的受控能力；Lantern 升级、端口或凭证变化后，重复运行同一命令即可同步。详细边界见 [Agent](./docs/agent.md)。

## 运行与数据

在源码或发行目录中，macOS 使用 `./lantern <command>`，Windows 使用 `lantern.cmd <command>`。如需在任意目录直接执行 `lantern`，可在 Lantern 目录中额外运行一次 `npm link`。

| 命令 | 用途 |
|---|---|
| `./lantern start` | 启动 Lantern |
| `./lantern status` | 查看当前运行状态 |
| `./lantern stop` | 停止 Lantern 管理的本地服务 |
| `./lantern doctor` | 检查环境、配置、数据库、对象文件和服务状态 |
| `./lantern agent:install` | 安装或同步 MCP 与 Skill |
| `./lantern backup:create` | 创建一致备份 |
| `./lantern backup:restore <backup-file>` | 恢复一致备份 |

| 系统 | 默认数据目录 |
|---|---|
| macOS | `~/Library/Application Support/Lantern` |
| Windows | `%APPDATA%\Lantern` |

`lantern.db` 保存作品与任务状态，`objects/` 保存图片和导出文件，`config/` 保存运行配置与模型密钥，`logs/` 保存日志。删除安装目录或更换源码包不会删除这些作品数据。

### 备份与恢复

备份包含作品、工作稿、消息、任务、候选、快照和本地对象文件，不包含模型 Key、安装令牌、日志或临时文件。备份和恢复前需要停止 Lantern：

```bash
./lantern stop
./lantern backup:create
./lantern backup:restore "/path/to/lantern-backup-<time>.zip"
```

恢复前会验证 manifest、SHA-256 和 SQLite 完整性；验证失败不会替换当前作品。

<details>
<summary>一次性覆盖运行设置</summary>

| 变量 | 用途 |
|---|---|
| `LANTERN_DATA_DIR` | 指定数据目录 |
| `WEB_PORT` | 指定 Web 端口 |
| `API_PORT` | 指定本地 API 端口 |
| `LANTERN_NO_OPEN=1` | 启动后不自动打开浏览器 |

macOS 示例：

```bash
LANTERN_DATA_DIR="$HOME/LanternData" WEB_PORT=3100 npm start
```

</details>

## 诊断与支持范围

遇到启动或数据问题时，先运行：

```bash
./lantern doctor
```

`doctor` 检查 Node.js 版本、数据目录写入权限、Provider 配置权限、SQLite 完整性、已引用对象文件和运行服务健康状态，不显示模型 Key 或安装令牌。

<details>
<summary>进一步排查</summary>

1. 确认 `config/runtime.json` 中的 Web 与 API 端口未被占用。
2. 查看数据目录中的 `logs/api.log` 与 `logs/web.log`。
3. 修正问题后重新运行 `./lantern start`。

</details>

当前发行单位是可运行源码包，尚未提供独立图形安装器。正式发行以 GitHub Actions 的实际验收结果为准；当前验收覆盖 macOS 14 和 Windows Server 2022，Linux 未列入支持范围。

## 开发与构建

开发模式使用与正式启动相同的本地数据和服务边界：

```bash
./lantern dev
```

常用验证命令：

```bash
./lantern typecheck
./lantern test
./lantern test:integration
./lantern lint
./lantern build
```

Windows 将 `./lantern` 换成 `lantern.cmd`。

创建可分发的源码 ZIP 和 SHA-256 校验文件：

```bash
./lantern package:release
```

产物写入 `release/lantern-<version>-source.zip` 和 `release/SHA256SUMS`。推送与 `package.json` 一致的 `v<version>` 标签后，GitHub Actions 会验证、打包并创建 GitHub Release。

## 架构与文档

```text
Web (React / Vinext)
  → Fastify API
      → Domain Service / Capability
      → SQLite / Prisma
      → Local Task Runner → Model Provider
      → Local Object Storage
```

- `apps/web` 是浏览器工作台，`apps/api` 是只监听 loopback 的本地 API 服务。

- `packages/shared` 提供 LCD、工作区命令和共享契约，`packages/editor-core` 与 `packages/layout-engine` 提供确定性编辑和页面布局能力。

- `packages/server` 负责本地持久化与对象存储，`packages/agent-runtime` 负责 Agent 上下文、任务和模型适配。Web UI、内置 Agent 和外置 Agent 共享领域服务、Editor Capability 和作品写入规则。

| 文档 | 内容 |
|---|---|
| [文档入口](./docs/README.md) | 产品、编辑器、LCD 与 Agent 正式文档的阅读顺序 |
| [LCD](./docs/lcd.md) | 作品结构、坐标、分层、资源引用和写入不变量 |
| [Agent](./docs/agent.md) | Agent 能力、上下文、任务、Candidate 和扩展边界 |
| [开发边界](./AGENTS.md) | 仓库导航、稳定架构边界和交付要求 |

## 许可证与反馈

Lantern 使用 [MIT License](./LICENSE) 开源。

如果遇到问题或希望提交功能建议，请使用 [GitHub Issues](https://github.com/lanseqingling/lantern/issues)。提交前请勿公开模型 Key、安装令牌、本地路径或未公开作品内容。
