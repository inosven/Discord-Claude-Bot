# Discord Claude Bot

A Discord bot that acts as a remote terminal for [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code). Chat with Claude Code directly from Discord — with streaming responses, tool usage progress, conversation resume, and per-user session management.

Discord Bot 作为 [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) 的远程终端。从 Discord 直接与 Claude Code 对话 — 支持流式输出、工具使用进度、对话恢复和多用户会话管理。

---

## Features / 功能

- **Streaming responses** — See Claude's output in real-time, not just "bot is typing"
  
  **流式输出** — 实时看到 Claude 的回复，而不是一直显示"正在输入"

- **Tool usage progress** — Shows what Claude is doing: *Reading file...*, *Searching...*, *Running command...*
  
  **工具使用进度** — 显示 Claude 正在做什么：*Reading file...*、*Searching...*、*Running command...*

- **Resume conversations** — Pick up any previous Claude Code conversation from a dropdown menu
  
  **恢复对话** — 从下拉菜单中选择任意历史 Claude Code 对话继续

- **Switch directories** — Work on different projects by changing the working directory
  
  **切换目录** — 通过切换工作目录来操作不同项目

- **Per-user sessions** — Each user gets their own independent Claude conversation
  
  **多用户会话** — 每个用户有独立的 Claude 对话

- **Graceful shutdown** — Kills all child Claude processes on exit
  
  **优雅退出** — 退出时自动终止所有 Claude 子进程

## Prerequisites / 前置条件

- [Node.js](https://nodejs.org/) v18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`npm install -g @anthropic-ai/claude-code`)
- A Discord bot token

## Setup / 安装

### 1. Clone and install / 克隆并安装

```bash
git clone https://github.com/yourusername/discord-claude-bot.git
cd discord-claude-bot
npm install
```

### 2. Create Discord Bot / 创建 Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, give it a name
3. Go to **Bot** → **Reset Token** → copy the token
4. Enable **MESSAGE CONTENT INTENT** under Bot settings
5. Go to **OAuth2** → **URL Generator**:
   - Scopes: `bot`
   - Permissions: `Send Messages`, `Read Message History`, `View Channels`
6. Open the generated URL to invite the bot to your server

---

1. 打开 [Discord Developer Portal](https://discord.com/developers/applications)
2. 点击 **New Application**，起个名字
3. 进入 **Bot** → **Reset Token** → 复制 token
4. 在 Bot 设置中开启 **MESSAGE CONTENT INTENT**
5. 进入 **OAuth2** → **URL Generator**：
   - Scopes 勾选：`bot`
   - Permissions 勾选：`Send Messages`、`Read Message History`、`View Channels`
6. 打开生成的 URL 将 bot 邀请到你的服务器

### 3. Configure / 配置

```bash
cp .env.example .env
```

Edit `.env` and fill in your bot token:

编辑 `.env` 并填入你的 bot token：

```env
DISCORD_BOT_TOKEN=your-actual-token-here
DISCORD_CHANNEL_ID=your-channel-id  # optional
```

> **Tip:** To get a channel ID, enable Developer Mode in Discord settings, then right-click a channel → Copy Channel ID.
> 
> **提示：** 获取频道 ID：在 Discord 设置中开启开发者模式，然后右键频道 → 复制频道 ID。

### 4. Run / 运行

```bash
npm start
```

You should see:

```
Logged in as YourBot#1234
Bot is in 1 server(s)
```

## Commands / 命令

| Command | Description |
|---------|-------------|
| `!cd <path>` | Set Claude's working directory / 设置 Claude 工作目录 |
| `!pwd` | Show current working directory / 显示当前工作目录 |
| `!resume` | Pick a previous conversation to resume / 选择历史对话恢复 |
| `!reset` | Start a fresh conversation / 开始新对话 |
| `!model <name>` | Switch model (sonnet, opus, haiku) / 切换模型 |
| `!usage` | Show API usage / 显示 API 用量 |
| `!help` | Show all commands / 显示所有命令 |

## How it works / 工作原理

```
Discord User  ←→  Discord Bot (Node.js)  ←→  Claude Code CLI
    chat              relay                    spawn per message
```

1. User sends a message in Discord
2. Bot spawns `claude -p --output-format stream-json` as a child process
3. User's message is piped to Claude via stdin
4. Claude's streaming JSON response is parsed in real-time
5. Bot edits its Discord reply every ~2s with the latest output
6. Tool usage (Read, Write, Bash, etc.) is shown as status updates
7. Final response is split into multiple messages if needed (Discord 2000 char limit)

---

1. 用户在 Discord 发送消息
2. Bot 启动 `claude -p --output-format stream-json` 子进程
3. 用户消息通过 stdin 传递给 Claude
4. Claude 的流式 JSON 响应被实时解析
5. Bot 每约 2 秒编辑 Discord 回复，显示最新输出
6. 工具使用（Read、Write、Bash 等）作为状态更新显示
7. 最终回复超过 2000 字符时自动分割为多条消息

## Behavior / 行为

- **In configured channels** (`DISCORD_CHANNEL_ID`): Bot responds to ALL messages, no @mention needed
  
  **在配置的频道中**：Bot 回复所有消息，不需要 @提及

- **In other channels**: Bot only responds when @mentioned
  
  **在其他频道中**：只有 @提及时才回复

- **In DMs**: Bot always responds
  
  **在私信中**：始终回复

## License / 许可证

MIT
