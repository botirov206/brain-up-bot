import { Bot, type Context } from "grammy";
import { config } from "./config.js";
import { parseCommand } from "./commands.js";
import { handleAdminCommand } from "./handlers/admin.js";
import { handleMedia, nudgeIfWaiting } from "./handlers/media.js";
import { handleStart } from "./handlers/start.js";
import { logError } from "./log.js";
import { texts } from "./texts.js";

const ADMIN_COMMANDS = new Set(["settings", "topics", "topicadd", "report", "members"]);

async function guard(label: string, ctx: Context, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logError(label, err);
    try {
      await ctx.reply(texts.genericError);
    } catch (replyErr) {
      logError("error reply", replyErr);
    }
  }
}

export function createBot(): Bot {
  const bot = new Bot(config.botToken);

  bot.catch((botError) => {
    logError("bot", botError.error);
  });

  bot.on("message:text", async (ctx) => {
    const parsed = parseCommand(ctx.message.text);
    await guard(parsed ? `command /${parsed.name}` : "text", ctx, async () => {
      if (!parsed) {
        await nudgeIfWaiting(ctx);
        return;
      }
      if (parsed.name === "start") {
        await handleStart(ctx, bot, parsed.body);
        return;
      }
      if (ADMIN_COMMANDS.has(parsed.name)) {
        await handleAdminCommand(ctx, bot, parsed.name, parsed.body);
      }
    });
  });

  bot.on("message:voice", (ctx) => guard("voice", ctx, () => handleMedia(ctx, bot)));
  bot.on("message:video_note", (ctx) => guard("video_note", ctx, () => handleMedia(ctx, bot)));
  bot.on("message:audio", (ctx) => guard("audio", ctx, () => handleMedia(ctx, bot)));

  bot.on("message", async (ctx) => {
    const message = ctx.message;
    if (!message) return;
    if (message.text || message.voice || message.video_note || message.audio) return;
    await guard("nudge", ctx, () => nudgeIfWaiting(ctx));
  });

  return bot;
}

export async function registerCommandMenu(bot: Bot): Promise<void> {
  const member = [{ command: "start", description: "Botni boshlash" }];
  const admin = [
    ...member,
    { command: "settings", description: "Show or change schedule times" },
    { command: "topics", description: "List or add topics" },
    { command: "topicadd", description: "Add one topic" },
    { command: "report", description: "Post today's recap" },
    { command: "members", description: "Show member counts" },
  ];
  try {
    await bot.api.setMyCommands(member);
  } catch (err) {
    logError("setMyCommands", err);
    return;
  }
  for (const id of config.adminIds) {
    try {
      await bot.api.setMyCommands(admin, {
        scope: { type: "chat", chat_id: Number(id) },
      });
    } catch (err) {
      // Telegram returns "chat not found" until that admin has opened the bot. Not fatal.
      logError(`setMyCommands admin ${id}`, err);
    }
  }
}
