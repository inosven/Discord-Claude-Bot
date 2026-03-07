# Discord Claude Bot

> **[English](./README.md)**

一个 Discord Bot，作为 [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) 的远程终端。从 Discord 直接与 Claude Code 对话 — 支持流式输出、工具使用进度、对话恢复和多用户会话管理。

## 功能

- **流式输出** — 实时看到 Claude 的回复，而不是一直显示"正在输入"
- **工具使用进度** — 显示 Claude 正在做什么：*Reading file...*、*Searching...*、*Running command...*
- **恢复对话** — 从下拉菜单中选择任意历史 Claude Code 对话继续
- **切换目录** — 通过切换工作目录来操作不同项目
- **多用户会话** — 每个用户有独立的 Claude 对话
- **Token 用量追踪** — 追踪每个 session 的输入/输出 token 数
- **优雅退出** — 退出时自动终止所有 Claude 子进程

## 前置条件

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) 已安装并完成认证（`npm install -g @anthropic-ai/claude-code`）
- 一个 Discord Bot Token

## 快速开始（预编译二进制文件）

从 [Releases](https://github.com/inosven/Discord-Claude-Bot/releases) 下载最新版本：

| 平台 | 文件 |
|------|------|
| Windows x64 | `discord-claude-bot-win.exe` |
| macOS x64（Intel / Rosetta 2） | `discord-claude-bot-macos` |

1. [创建 Discord Bot](#创建-discord-bot) 并获取 token
2. 在二进制文件同目录下创建 `.env` 文件：
   ```env
   DISCORD_BOT_TOKEN=你的token
   DISCORD_CHANNEL_ID=你的频道ID  # 可选
   ```
3. 运行：
   - **Windows：** 双击 `discord-claude-bot-win.exe` 或在终端运行
   - **macOS：** `chmod +x discord-claude-bot-macos && ./discord-claude-bot-macos`

> **注意：** macOS x64 版本可通过 Rosetta 2 在 Apple Silicon Mac 上运行。

## 从源码安装

除上述前置条件外，还需要 [Node.js](https://nodejs.org/) v18+。

### 1. 克隆并安装

```bash
git clone https://github.com/inosven/Discord-Claude-Bot.git
cd Discord-Claude-Bot
npm install
```

### 2. 创建 Discord Bot

1. 打开 [Discord Developer Portal](https://discord.com/developers/applications)
2. 点击 **New Application**，起个名字
3. 进入 **Bot** → **Reset Token** → 复制 token
4. 在 Bot 设置中开启 **MESSAGE CONTENT INTENT**
5. 进入 **OAuth2** → **URL Generator**：
   - Scopes 勾选：`bot`
   - Permissions 勾选：`Send Messages`、`Read Message History`、`View Channels`
6. 打开生成的 URL 将 bot 邀请到你的服务器

### 3. 配置

```bash
cp .env.example .env
```

编辑 `.env` 并填入你的 bot token：

```env
DISCORD_BOT_TOKEN=你的token
DISCORD_CHANNEL_ID=你的频道ID  # 可选
```

> **提示：** 获取频道 ID：在 Discord 设置中开启开发者模式，然后右键频道 → 复制频道 ID。

### 4. 运行

```bash
npm start
```

看到以下输出说明启动成功：

```
Logged in as YourBot#1234
Bot is in 1 server(s)
```

## 自行构建二进制文件

```bash
npm install
npm run build        # 同时构建 Windows 和 macOS
npm run build:win    # 仅 Windows
npm run build:mac    # 仅 macOS
```

输出文件在 `dist/` 目录下。

## 命令

| 命令 | 说明 |
|------|------|
| `!cd <路径>` | 设置 Claude 工作目录 |
| `!pwd` | 显示当前工作目录 |
| `!resume` | 选择历史对话恢复 |
| `!reset` | 开始新对话 |
| `!model <名称>` | 切换模型（sonnet、opus、haiku） |
| `!usage` | 显示 session token 用量 |
| `!help` | 显示所有命令 |

## 工作原理

```
Discord 用户  ←→  Discord Bot (Node.js)  ←→  Claude Code CLI
    聊天              转发                    每条消息启动一个进程
```

1. 用户在 Discord 发送消息
2. Bot 启动 `claude -p --output-format stream-json` 子进程
3. 用户消息通过 stdin 传递给 Claude
4. Claude 的流式 JSON 响应被实时解析
5. Bot 每约 2 秒编辑 Discord 回复，显示最新输出
6. 工具使用（Read、Write、Bash 等）作为状态更新显示
7. 最终回复超过 2000 字符时自动分割为多条消息

## 行为

- **在配置的频道中**（`DISCORD_CHANNEL_ID`）：Bot 回复所有消息，不需要 @提及
- **在其他频道中**：只有 @提及时才回复
- **在私信中**：始终回复

## 许可证

MIT
