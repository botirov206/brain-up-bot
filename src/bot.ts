import { Bot, type Context } from "grammy";
import { memberCommands } from "./admin-ui.js";
import { config } from "./config.js";
import { parseCommand } from "./commands.js";
import { handleAdminButton, handleAdminCommand } from "./handlers/admin.js";
import { captureExplanation, captureGroupExplanation } from "./handlers/explain.js";
import { beginFeedback, captureFeedback, handleMemberButton } from "./handlers/feedback.js";
import { handleFlowCallback } from "./handlers/flow.js";
import { captureAnnouncement, captureJudgment, captureTodo, handleForumTodo } from "./handlers/flow.js";
import { handleMedia, handleYoutube, nudgeIfWaiting } from "./handlers/media.js";
import { handleStart } from "./handlers/start.js";
import { extractYoutubeUrls } from "./youtube.js";
import { saveMembership } from "./store.js";
import { classifyChatMember } from "./membership.js";
import { getGroupChatId, upsertUser } from "./repo.js";
import { displayName } from "./names.js";
import { admitWaitlist } from "./store.js";
import { logError } from "./log.js";
import { clearUserPending } from "./repo.js";
import { texts } from "./texts.js";

const ADMIN_COMMANDS = new Set(["settings", "topics", "topicadd", "report", "members", "group", "bindtopic"]);

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
    if (ctx.from?.is_bot || ctx.message?.sender_chat) return;
    const parsed = parseCommand(ctx.message.text, config.botUsername);
    await guard(parsed ? `command /${parsed.name}` : "text", ctx, async () => {
      if (!parsed) {
        if (await handleAdminButton(ctx, bot)) return;
        if (await handleMemberButton(ctx, bot)) return;
        if (await captureTodo(ctx, bot)) return;
        if (await captureJudgment(ctx, bot)) return;
        if (await captureAnnouncement(ctx)) return;
        if (await captureFeedback(ctx)) return;
        if (await captureExplanation(ctx)) return;
        if (await captureGroupExplanation(ctx)) return;
        if (await handleForumTodo(ctx, bot, ctx.message?.text ?? "")) return;
        const link = extractYoutubeUrls(ctx.message?.text ?? "", ctx.message?.entities ?? [])[0];
        if (link && (await handleYoutube(ctx, bot, link))) return;
        await nudgeIfWaiting(ctx);
        return;
      }
      if (ctx.chat?.type === "private" && ctx.from) await clearUserPending(String(ctx.from.id));
      if (parsed.name === "todo") {
        const accepted = await handleForumTodo(ctx, bot, parsed.body, true);
        if (!accepted && ctx.chat?.type === "private") {
          await ctx.reply("Rejani «📋 Bugungi rejam» tugmasi orqali yozing.");
        }
        return;
      }
      if (parsed.name === "feedback") {
        await beginFeedback(ctx, parsed.body);
        return;
      }
      if (parsed.name === "start") {
        await handleStart(ctx, bot, parsed.body);
        return;
      }
      if (parsed.name === "admin") {
        const { openAdminHome } = await import("./handlers/admin.js");
        await openAdminHome(ctx);
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
  bot.on("message:video", (ctx) => guard("video", ctx, () => handleMedia(ctx, bot)));
  bot.on("message:document", (ctx) => guard("document", ctx, () => handleMedia(ctx, bot)));
  bot.on("callback_query:data", (ctx) => guard("callback", ctx, async () => {
    try {
      await handleFlowCallback(ctx, bot);
    } finally {
      try {
        await ctx.answerCallbackQuery();
      } catch (err) {
        logError("callback answer", err);
      }
    }
  }));
  bot.on("chat_member", (ctx) => guard("chat_member", ctx, () => observeMember(ctx)));
  bot.on("my_chat_member", (ctx) => guard("my_chat_member", ctx, () => observeBot(ctx)));

  bot.on("message", async (ctx) => {
    const message = ctx.message;
    if (!message) return;
    if (message.text || message.voice || message.video_note || message.audio || message.video || message.document) return;
    await guard("nudge", ctx, () => nudgeIfWaiting(ctx));
  });

  return bot;
}

async function observeMember(ctx: Context): Promise<void> {
  const chatId = ctx.chat ? String(ctx.chat.id) : "";
  const saved = await getGroupChatId();
  if (!saved || chatId !== saved) return;
  const member = ctx.chatMember?.new_chat_member;
  if (!member || member.user.is_bot) return;
  const check = classifyChatMember(member);
  if (check.kind === "unavailable") return;
  const user = await upsertUser({
    telegramId: String(member.user.id),
    name: displayName(member.user),
    username: member.user.username ?? null,
    makeAdmin: false,
    started: false,
  });
  await saveMembership(saved, String(member.user.id), check);
  if (check.kind === "member") await admitWaitlist(user.id);
}

async function observeBot(ctx: Context): Promise<void> {
  const status = ctx.myChatMember?.new_chat_member.status;
  if (!status) return;
  const { setBotForumStatus } = await import("./store.js");
  await setBotForumStatus(status);
}

export async function registerCommandMenu(bot: Bot): Promise<void> {
  try {
    await bot.api.setMyCommands(memberCommands);
  } catch (err) {
    logError("setMyCommands", err);
    return;
  }
}
