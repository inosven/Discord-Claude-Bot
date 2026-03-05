require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Events,
  Partials,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// Per-user request queue to ensure sequential processing (Claude sessions lock)
const userQueues = new Map();

// Per-user working directory
const userCwds = new Map();

// Per-user model override
const userModels = new Map();

// Per-user active conversation ID (for --resume)
const activeConversations = new Map();

// Claude data directory
const CLAUDE_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".claude",
  "projects"
);

// ─── Conversation scanning ───

/**
 * Convert a filesystem path to Claude's project directory name.
 * e.g. C:\Users\sunqu\Projects\Foo → C--Users-sunqu-Projects-Foo
 */
function cwdToProjectDir(cwd) {
  return cwd.replace(/[:\\/]/g, "-");
}

/**
 * Scan .jsonl files in the matching project directory for conversations.
 */
function loadConversations(filterCwd) {
  const all = [];

  // Find matching project directories
  let projectDirs;
  try {
    const allProjs = fs.readdirSync(CLAUDE_DIR);
    if (filterCwd) {
      const target = cwdToProjectDir(filterCwd).toLowerCase();
      projectDirs = allProjs.filter((p) => p.toLowerCase() === target);
    } else {
      projectDirs = allProjs;
    }
  } catch {
    return [];
  }

  for (const proj of projectDirs) {
    const projDir = path.join(CLAUDE_DIR, proj);
    try {
      if (!fs.statSync(projDir).isDirectory()) continue;
    } catch {
      continue;
    }

    const files = fs.readdirSync(projDir).filter((f) => f.endsWith(".jsonl"));
    for (const file of files) {
      const filePath = path.join(projDir, file);
      const sessionId = path.basename(file, ".jsonl");
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }

      let firstPrompt = "";
      let cwd = "";
      let gitBranch = "";
      try {
        const buf = Buffer.alloc(20480);
        const fd = fs.openSync(filePath, "r");
        const bytesRead = fs.readSync(fd, buf, 0, 20480, 0);
        fs.closeSync(fd);
        const head = buf.toString("utf-8", 0, bytesRead);
        for (const line of head.split("\n")) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (
              obj.type === "user" &&
              obj.message &&
              obj.message.role === "user" &&
              !obj.isMeta
            ) {
              const content = obj.message.content;
              if (typeof content === "string" && !content.startsWith("<")) {
                firstPrompt = content.substring(0, 100);
                cwd = obj.cwd || "";
                gitBranch = obj.gitBranch || "";
                break;
              }
            }
          } catch {}
        }
      } catch {}

      all.push({
        sessionId,
        firstPrompt: firstPrompt || "(session)",
        modified: stat.mtime.toISOString(),
        projectPath: cwd,
        gitBranch,
        size: stat.size,
      });
    }
  }

  all.sort((a, b) => new Date(b.modified) - new Date(a.modified));
  return all;
}

// ─── Helpers ───

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function enqueueForUser(userId, task) {
  const prev = userQueues.get(userId) || Promise.resolve();
  const next = prev.then(task, task);
  userQueues.set(userId, next);
  next.finally(() => {
    if (userQueues.get(userId) === next) userQueues.delete(userId);
  });
  return next;
}

function splitMessage(text, maxLength = 2000) {
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf("\n", maxLength);
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      splitIndex = maxLength;
    }

    let chunk = remaining.substring(0, splitIndex);
    remaining = remaining.substring(splitIndex).trimStart();

    const codeBlockMatches = chunk.match(/```/g);
    if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
      const lastFenceIndex = chunk.lastIndexOf("```");
      const fenceLineEnd = chunk.indexOf("\n", lastFenceIndex);
      const fenceLine = chunk.substring(
        lastFenceIndex,
        fenceLineEnd !== -1 ? fenceLineEnd : chunk.length
      );
      const lang = fenceLine.replace("```", "").trim();
      chunk += "\n```";
      remaining = "```" + lang + "\n" + remaining;
    }

    chunks.push(chunk);
  }

  return chunks;
}

// ─── Discord client ───

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const ALLOWED_CHANNELS = process.env.DISCORD_CHANNEL_ID
  ? process.env.DISCORD_CHANNEL_ID.split(",").map((id) => id.trim())
  : null;

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  console.log(`Bot is in ${c.guilds.cache.size} server(s)`);
  if (ALLOWED_CHANNELS) {
    console.log(`Restricted to channel(s): ${ALLOWED_CHANNELS.join(", ")}`);
  } else {
    console.log(
      "Listening in ALL channels (set DISCORD_CHANNEL_ID to restrict)"
    );
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const isDM = !message.guild;
  const isMentioned =
    !isDM && message.mentions.has(client.user, { ignoreEveryone: true });
  const isAllowedChannel =
    !isDM &&
    ALLOWED_CHANNELS &&
    ALLOWED_CHANNELS.includes(message.channel.id);
  if (!isDM && !isMentioned && !isAllowedChannel) return;

  let userMessage = message.content.trim();
  if (isMentioned) {
    userMessage = userMessage.replace(/<@!?\d+>/g, "").trim();
  }

  // === Commands ===

  if (userMessage === "!reset") {
    activeConversations.delete(message.author.id);
    await message.reply("Session reset. Next message starts a fresh conversation.");
    return;
  }

  if (userMessage === "!resume") {
    const currentCwd =
      userCwds.get(message.author.id) ||
      process.env.CLAUDE_WORKING_DIR ||
      process.cwd();
    const conversations = loadConversations(currentCwd);
    if (conversations.length === 0) {
      await message.reply(
        `No conversations found in \`${currentCwd}\`.\nUse \`!cd <path>\` to switch directory first.`
      );
      return;
    }

    const options = conversations.slice(0, 25).map((c) => {
      const ago = timeAgo(new Date(c.modified));
      const sizeStr =
        c.size > 1024 * 1024
          ? (c.size / 1024 / 1024).toFixed(1) + "MB"
          : (c.size / 1024).toFixed(1) + "KB";
      const label = (c.firstPrompt || "(session)").substring(0, 95);
      const desc = [ago, c.gitBranch || "", sizeStr]
        .filter(Boolean)
        .join(" · ");
      return {
        label,
        description: desc.substring(0, 100),
        value: c.sessionId,
      };
    });

    const select = new StringSelectMenuBuilder()
      .setCustomId("resume_conversation")
      .setPlaceholder("Pick a conversation to resume")
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(select);
    const reply = await message.reply({
      content: `**Resume Session** (${conversations.length} total, in \`${path.basename(currentCwd)}\`)`,
      components: [row],
    });

    try {
      const interaction = await reply.awaitMessageComponent({
        filter: (i) => i.user.id === message.author.id,
        time: 60_000,
      });

      const sessionId = interaction.values[0];
      const selected = conversations.find((c) => c.sessionId === sessionId);

      activeConversations.set(message.author.id, sessionId);

      await interaction.update({
        content: `Resumed: **${selected?.firstPrompt || sessionId}**\nSend your next message to continue.`,
        components: [],
      });
    } catch {
      await reply.edit({
        content: "Timed out. Try `!resume` again.",
        components: [],
      });
    }
    return;
  }

  if (userMessage.startsWith("!cd ")) {
    const dir = userMessage.slice(4).trim();
    if (!dir) {
      await message.reply("Usage: `!cd <path>`");
      return;
    }
    const resolved = path.resolve(dir);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      await message.reply(`Directory not found: \`${resolved}\``);
      return;
    }
    userCwds.set(message.author.id, resolved);
    await message.reply(`Working directory set to: \`${resolved}\``);
    return;
  }

  if (userMessage === "!pwd") {
    const cwd =
      userCwds.get(message.author.id) ||
      process.env.CLAUDE_WORKING_DIR ||
      process.cwd();
    await message.reply(`Current working directory: \`${cwd}\``);
    return;
  }

  if (userMessage === "!usage") {
    try {
      const output = await runClaudeCommand(["usage"]);
      await message.reply(output || "No usage data available.");
    } catch (err) {
      await message.reply(`Failed to get usage: ${err.message}`);
    }
    return;
  }

  if (userMessage.startsWith("!model")) {
    const model = userMessage.slice(6).trim();
    if (!model) {
      const current = userModels.get(message.author.id) || "default";
      await message.reply(
        `Current model: \`${current}\`\nUsage: \`!model <name>\` (e.g. sonnet, opus, haiku)`
      );
      return;
    }
    userModels.set(message.author.id, model);
    await message.reply(`Model set to: \`${model}\``);
    return;
  }

  if (userMessage === "!help") {
    await message.reply(
      [
        "**Commands:**",
        "`!resume` - Pick a previous conversation to resume",
        "`!reset` - Start a fresh conversation",
        "`!cd <path>` - Set Claude's working directory",
        "`!pwd` - Show current working directory",
        "`!model <name>` - Switch model (sonnet, opus, haiku)",
        "`!usage` - Show API usage",
        "`!help` - Show this help message",
      ].join("\n")
    );
    return;
  }

  if (!userMessage) {
    await message.reply(
      "You mentioned me but didn't say anything! Try asking me a question."
    );
    return;
  }

  // === Send to Claude (streaming) ===

  enqueueForUser(message.author.id, async () => {
    const userCwd = userCwds.get(message.author.id);
    const userModel = userModels.get(message.author.id);
    const activeConvId = activeConversations.get(message.author.id);

    try {
      const { text, conversationId } = await callClaudeStreaming(
        message,
        userMessage,
        userCwd,
        userModel,
        activeConvId
      );

      if (conversationId) {
        activeConversations.set(message.author.id, conversationId);
      }
    } catch (err) {
      console.error("Error calling Claude:", err.message);
      await message.reply(`Something went wrong: ${err.message}`);
    }
  });
});

// ─── Track child processes for cleanup ───

const activeChildren = new Set();

function cleanup() {
  console.log(`\nShutting down... killing ${activeChildren.size} child process(es)`);
  for (const child of activeChildren) {
    try {
      child.kill();
    } catch {}
  }
  client.destroy();
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("SIGHUP", cleanup);

// ─── Claude integration ───

// Strip CLAUDECODE env var so child processes don't think they're nested
const cleanEnv = { ...process.env, CLAUDECODE: "" };

function runClaudeCommand(args) {
  return new Promise((resolve, reject) => {
    const cmd = "claude " + args.join(" ");
    const child = spawn(cmd, [], { shell: true, env: cleanEnv });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr || `Exited with code ${code}`));
      else resolve(stdout.trim());
    });
    child.on("error", (err) => reject(err));
  });
}

/**
 * Call Claude with stream-json output and update Discord message in real-time.
 */
function callClaudeStreaming(message, prompt, userCwd, userModel, activeConvId) {
  return new Promise(async (resolve, reject) => {
    const cwd = userCwd || process.env.CLAUDE_WORKING_DIR || process.cwd();

    let cmd = "claude -p --dangerously-skip-permissions --verbose --output-format stream-json";
    if (activeConvId) cmd += ` --resume ${activeConvId}`;
    if (userModel) cmd += ` --model ${userModel}`;

    console.log(
      `[${message.author.id}] conv=${activeConvId || "new"} cwd=${cwd} prompt="${prompt.substring(0, 80)}${prompt.length > 80 ? "..." : ""}"`
    );

    const child = spawn(cmd, [], { shell: true, cwd, env: cleanEnv });
    activeChildren.add(child);
    child.stdin.write(prompt);
    child.stdin.end();

    let stderr = "";
    let lineBuffer = "";
    let resultText = "";
    let conversationId = null;
    let currentStatus = "Thinking...";
    let replyMsg = null;
    let lastEditTime = 0;
    let editPending = false;
    let editTimer = null;
    let finished = false;

    // Send initial message
    try {
      replyMsg = await message.reply("Thinking...");
    } catch {
      reject(new Error("Failed to send reply"));
      return;
    }

    function scheduleEdit() {
      if (editPending || finished) return;
      const now = Date.now();
      const elapsed = now - lastEditTime;
      if (elapsed >= 2000) {
        doEdit();
      } else {
        editPending = true;
        editTimer = setTimeout(() => {
          editPending = false;
          doEdit();
        }, 2000 - elapsed);
      }
    }

    function doEdit() {
      if (finished) return;
      lastEditTime = Date.now();
      const display = buildDisplay();
      if (display && replyMsg) {
        // Truncate to 2000 chars for intermediate updates
        replyMsg.edit(display.substring(0, 2000)).catch(() => {});
      }
    }

    function buildDisplay() {
      let display = "";
      if (resultText) {
        display = resultText;
      }
      if (currentStatus && !resultText) {
        display = `*${currentStatus}*`;
      } else if (currentStatus && resultText) {
        display = resultText + `\n\n*${currentStatus}*`;
      }
      return display || "Thinking...";
    }

    child.stdout.on("data", (data) => {
      lineBuffer += data.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          handleStreamEvent(event);
        } catch {}
      }
    });

    // Track current tool name for input_json_delta parsing
    let currentToolName = "";
    let currentToolInput = "";

    function handleStreamEvent(event) {
      switch (event.type) {
        case "content_block_start":
          if (event.content_block?.type === "tool_use") {
            currentToolName = event.content_block.name || "tool";
            currentToolInput = "";
            currentStatus = `Using ${currentToolName}...`;
            scheduleEdit();
          }
          break;

        case "content_block_delta":
          if (event.delta?.type === "text_delta" && event.delta.text) {
            resultText += event.delta.text;
            currentStatus = "";
            scheduleEdit();
          } else if (event.delta?.type === "input_json_delta" && event.delta.partial_json) {
            // Accumulate tool input JSON to extract useful info
            currentToolInput += event.delta.partial_json;
            // Try to extract file_path, pattern, command, etc. for status
            try {
              const partial = JSON.parse(currentToolInput);
              currentStatus = formatToolStatus(currentToolName, partial);
              scheduleEdit();
            } catch {
              // JSON incomplete, that's fine
            }
          }
          break;

        case "content_block_stop":
          // Tool use finished, clear tool tracking
          if (currentToolName) {
            currentStatus = "";
            currentToolName = "";
            currentToolInput = "";
          }
          break;

        case "assistant":
          // Full assistant message (non-streaming fallback)
          if (event.message?.content && Array.isArray(event.message.content)) {
            for (const block of event.message.content) {
              if (block.type === "text" && block.text) {
                resultText += block.text;
                currentStatus = "";
                scheduleEdit();
              }
              if (block.type === "tool_use") {
                currentStatus = formatToolStatus(block.name || "tool", block.input || {});
                scheduleEdit();
              }
            }
          }
          break;

        case "result":
          if (event.result) resultText = event.result;
          conversationId = event.conversation_id || conversationId;
          currentStatus = "";
          break;
      }
    }

    function formatToolStatus(toolName, input) {
      switch (toolName) {
        case "Read":
          return `Reading ${input.file_path || "file"}...`;
        case "Write":
          return `Writing ${input.file_path || "file"}...`;
        case "Edit":
          return `Editing ${input.file_path || "file"}...`;
        case "Glob":
          return `Searching files: ${input.pattern || ""}...`;
        case "Grep":
          return `Searching for: ${input.pattern || ""}...`;
        case "Bash":
          return `Running: ${(input.command || "").substring(0, 60)}...`;
        case "WebSearch":
          return `Searching web: ${input.query || ""}...`;
        case "WebFetch":
          return `Fetching: ${input.url || ""}...`;
        default:
          return `Using ${toolName}...`;
      }
    }

    child.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      // --verbose outputs progress to stderr; try to extract status
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("[")) continue; // skip timestamps/debug
        // Show stderr lines as status if we don't have a tool status already
        if (!currentToolName && trimmed.length > 3 && trimmed.length < 200) {
          currentStatus = trimmed;
          scheduleEdit();
        }
      }
    });

    child.on("close", async (code) => {
      finished = true;
      activeChildren.delete(child);
      if (editTimer) clearTimeout(editTimer);

      if (code !== 0) {
        if (replyMsg) {
          await replyMsg
            .edit(`Something went wrong: ${stderr || `exit code ${code}`}`.substring(0, 2000))
            .catch(() => {});
        }
        reject(new Error(stderr || `Claude exited with code ${code}`));
        return;
      }

      // Process any remaining buffer
      if (lineBuffer.trim()) {
        try {
          handleStreamEvent(JSON.parse(lineBuffer));
        } catch {}
      }

      const finalText = resultText.trim() || "(empty response)";
      const chunks = splitMessage(finalText);

      try {
        // Edit first message with first chunk
        await replyMsg.edit(chunks[0]);
        // Send remaining chunks as new messages
        for (let i = 1; i < chunks.length; i++) {
          await message.reply(chunks[i]);
        }
      } catch (err) {
        console.error("Error sending final message:", err.message);
      }

      resolve({ text: finalText, conversationId });
    });

    child.on("error", (err) => {
      finished = true;
      if (editTimer) clearTimeout(editTimer);
      reject(new Error(`Failed to start Claude: ${err.message}`));
    });

    // 5 minute timeout
    setTimeout(() => {
      if (!finished) {
        finished = true;
        child.kill();
        reject(new Error("Claude timed out after 5 minutes"));
      }
    }, 300_000);
  });
}

// ─── Login ───

if (!process.env.DISCORD_BOT_TOKEN) {
  console.error("ERROR: DISCORD_BOT_TOKEN is not set in .env");
  process.exit(1);
}

client.login(process.env.DISCORD_BOT_TOKEN);
