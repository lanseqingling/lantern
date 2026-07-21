# Lantern AI

Lantern AI 是面向个人漫画创作者的 AI 漫画创作工作台。它把故事、角色、场景、分镜、页面编排、单格精修、预览与导出放在一个持续可编辑的创作空间中，并通过 MCP 与 Skill 让产品内外的 Agent 复用同一套创作能力与作品边界。

## 核心能力

- 管理漫画、一话、故事设定、角色、场景、道具和视觉风格。
- 编辑分镜条目、漫画页、条漫段、画格、格内图片、纸面图片、对白与旁白。
- 支持双页、破格、跨页、跨段、画格重叠和固定资源版本等漫画编排能力。
- 通过内置 Agent 完成创作问答、图片理解、单格分镜编辑和图片生成候选。
- 以相同的 LCD、Capability 和 Candidate 边界连接 MCP 与配套 Skill。
- 预览作品，导出 PNG、LCD JSON 或包含图片资源的完整 LCD ZIP，并可将完整 ZIP 导入一话。

产品规则与协议文档从 [`docs/README.md`](./docs/README.md) 进入；仓库导航与开发边界见 [`AGENTS.md`](./AGENTS.md)。

## 获取与运行

Lantern 的发行单位是可运行源码包。运行环境需要带 npm 的 Node.js 22.13 或更高版本。

### 1. 安装 Node.js

从 [Node.js 官网](https://nodejs.org/en/download) 安装 Node.js 22.13 或更高版本，然后确认终端可以识别：

```bash
node --version
npm --version
```

### 2. 获取 Lantern

推荐从 [GitHub Releases](https://github.com/lanseqingling/lantern/releases/latest) 下载 `lantern-<version>-source.zip` 和同一版本的 `SHA256SUMS`。也可以使用 Git：

```bash
git clone https://github.com/lanseqingling/lantern.git
cd lantern
```

下载 Release 后先校验文件。macOS：

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

校验通过后解压源码包，在解压目录打开终端，再继续下一步。

### 3. 启动

macOS 和 Windows 使用同一条首次启动命令：

```bash
npm start
```

启动器会准备仓库锁定的依赖、初始化本地数据并启动 Web 工作台。首次创建空数据目录时会载入《雨夜车站》和《风停之前》两个示例漫画。启动完成后浏览器会打开 `http://localhost:3000`。

### 4. 配置模型

首次启动会创建 `config/providers.env`。填写所需的 Provider Key 后重新启动 Lantern：

```dotenv
TEXT_MODEL_PROVIDER=deepseek
TEXT_MODEL_API_KEY=你的 DeepSeek API Key
IMAGE_MODEL_PROVIDER=qwen
IMAGE_MODEL_API_KEY=你的百炼 API Key
```

图片理解默认复用图片模型的 Key；需要独立配置时填写同一文件中的 `VISION_MODEL_*`。

### 命令行

完成首次启动后，可以在仓库目录执行一次 `npm link`，随后直接使用：

```bash
lantern start
lantern status
lantern stop
lantern doctor
lantern backup:create
lantern backup:restore <backup-file>
```

不添加全局命令时，macOS 使用 `./lantern <command>`，Windows 使用 `lantern.cmd <command>`。

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

该命令需要在 Git checkout 中运行，并会在存在未跟踪文件时停止，避免把本地临时内容带入发行包。产物写入 `release/lantern-<version>-source.zip` 和 `release/SHA256SUMS`。推送与 `package.json` 一致的 `v<version>` 标签后，GitHub Actions 会在 macOS 和 Windows 上完成全新安装、启动、停止与重复启动验收，通过后创建 GitHub Release。

## 数据与配置

| 系统 | 默认数据目录 |
|---|---|
| macOS | `~/Library/Application Support/Lantern` |
| Windows | `%APPDATA%\Lantern` |

数据目录中的 `lantern.db` 保存作品与任务状态，`objects/` 保存图片和导出文件，`config/` 保存运行配置与模型密钥，`logs/` 保存日志。删除安装目录或更换源码包不会删除这里的作品。

以下环境变量可用于一次性覆盖运行设置：

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

## 备份与恢复

备份包含 SQLite 中的作品、工作稿、消息、任务、候选和快照，以及本地对象存储中的图片与导出文件。模型 Key、安装令牌、日志和临时文件不会写入备份。

备份和恢复要求 Lantern 已停止：

```bash
lantern stop
lantern backup:create
lantern backup:restore "/path/to/lantern-backup-<time>.zip"
```

默认备份写入数据目录的 `backups/`。恢复前会验证 manifest、每个文件的 SHA-256 和 SQLite 完整性；验证失败不会替换现有作品。恢复会覆盖当前数据库和对象文件，但保留当前安装的 Provider 配置。

## 诊断与支持范围

`lantern doctor` 检查 Node.js 版本、数据目录写入权限、Provider 配置权限、SQLite 完整性、已引用对象文件和运行服务健康状态。输出只包含 Provider 是否已配置，不显示模型 Key 或安装令牌。

遇到启动问题时依次检查：

1. 运行 `lantern doctor`；
2. 确认 `config/runtime.json` 中的 Web 与 API 端口未被占用；
3. 查看数据目录中的 `logs/api.log` 与 `logs/web.log`；
4. 修正问题后重新运行 `lantern start`。

正式 Release 以 GitHub Actions 实际通过的平台为准，当前发行链路覆盖 macOS 14 和 Windows Server 2022。Linux 未列入本阶段支持范围。

## 架构

```text
Web (React / Vinext)
  -> Fastify API
      -> Domain Service / Capability
      -> SQLite / Prisma
      -> Local Task Runner -> Model Provider
      -> Local Object Storage
```

- `packages/shared` 提供 LCD、工作区命令和共享契约。
- `packages/editor-core` 与 `packages/layout-engine` 提供确定性编辑和页面布局能力。
- `packages/server` 负责本地持久化与对象存储，`packages/agent-runtime` 负责 Agent 上下文、任务和模型适配。
- Web UI、产品内 Agent 和外置 Agent 共享领域 Capability，不各自复制作品写入规则。
