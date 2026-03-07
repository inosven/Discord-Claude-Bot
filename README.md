# Discord Claude Bot

> **[中文文档](./README_CN.md)**

A Discord bot that acts as a remote terminal for [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code). Chat with Claude Code directly from Discord — with streaming responses, tool usage progress, conversation resume, and per-user session management.

## Features

- **Streaming responses** — See Claude's output in real-time, not just "bot is typing"
- **Tool usage progress** — Shows what Claude is doing: *Reading file...*, *Searching...*, *Running command...*
- **Resume conversations** — Pick up any previous Claude Code conversation from a dropdown menu
- **Switch directories** — Work on different projects by changing the working directory
- **Per-user sessions** — Each user gets their own independent Claude conversation
- **Token usage tracking** — Track input/output tokens per session
- **Graceful shutdown** — Kills all child Claude processes on exit

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`npm install -g @anthropic-ai/claude-code`)
- A Discord bot token

## Setup

### 1. Clone and install

```bash
git clone https://github.com/inosven/Discord-Claude-Bot.git
cd Discord-Claude-Bot
npm install
```

### 2. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, give it a name
3. Go to **Bot** → **Reset Token** → copy the token
4. Enable **MESSAGE CONTENT INTENT** under Bot settings
5. Go to **OAuth2** → **URL Generator**:
   - Scopes: `bot`
   - Permissions: `Send Messages`, `Read Message History`, `View Channels`
6. Open the generated URL to invite the bot to your server

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env` and fill in your bot token:

```env
DISCORD_BOT_TOKEN=your-actual-token-here
DISCORD_CHANNEL_ID=your-channel-id  # optional
```

> **Tip:** To get a channel ID, enable Developer Mode in Discord settings, then right-click a channel → Copy Channel ID.

### 4. Run

```bash
npm start
```

You should see:

```
Logged in as YourBot#1234
Bot is in 1 server(s)
```

## Commands

| Command | Description |
|---------|-------------|
| `!cd <path>` | Set Claude's working directory |
| `!pwd` | Show current working directory |
| `!resume` | Pick a previous conversation to resume |
| `!reset` | Start a fresh conversation |
| `!model <name>` | Switch model (sonnet, opus, haiku) |
| `!usage` | Show session token usage |
| `!help` | Show all commands |

## How it works

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

## Behavior

- **In configured channels** (`DISCORD_CHANNEL_ID`): Bot responds to ALL messages, no @mention needed
- **In other channels**: Bot only responds when @mentioned
- **In DMs**: Bot always responds

## License

MIT
