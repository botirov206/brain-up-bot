import { Bot, type Context } from "grammy";
import { adminCommands, memberCommands } from "./admin-ui.js";
import { config } from "./config.js";
import { parseCommand } from "./commands.js";
import { handleAdminButton, handleAdminCommand } from "./handlers/admin.js";
import { captureExplanation, captureGroupExplanation } from "./handlers/explain.js";
import { beginFeedback, captureFeedback, handleMemberButton } from "./handlers/feedback.js";
import { handleMedia, nudgeIfWaiting } from "./handlers/media.js";
import { handleStart } from "./handlers/start.js";
import { logError } from "./log.js";
import { clearUserPending } from "./repo.js";
import { texts } from "./texts.js";

const ADMIN_COMMANDS = new Set(["settings", "topics", "topicadd", "report", "members", "group"]);

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
        if (await handleAdminButton(ctx, bot)) return;
        if (await handleMemberButton(ctx)) return;
        if (await captureFeedback(ctx)) return;
        if (await captureExplanation(ctx)) return;
        if (await captureGroupExplanation(ctx)) return;
        await nudgeIfWaiting(ctx);
        return;
      }
      if (ctx.chat?.type === "private" && ctx.from) await clearUserPending(String(ctx.from.id));
      if (parsed.name === "feedback") {
        await beginFeedback(ctx, parsed.body);
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
  try {
    await bot.api.setMyCommands(memberCommands);
  } catch (err) {
    logError("setMyCommands", err);
    return;
  }
  for (const id of config.adminIds) {
    try {
      await bot.api.setMyCommands(adminCommands, {
        scope: { type: "chat", chat_id: Number(id) },
      });
    } catch (err) {
      // Telegram returns "chat not found" until that admin has opened the bot. Not fatal.
      logError(`setMyCommands admin ${id}`, err);
    }
  }
}
