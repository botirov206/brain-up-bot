import type { Context } from "grammy";
import { requireParticipantAccess } from "../access.js";
import { memberButtons, memberMarkup } from "../admin-ui.js";
import { config } from "../config.js";
import { getGroupChatId } from "../repo.js";
import { escapeHtml, profileLink } from "../html.js";
import { displayName } from "../names.js";
import {
  findUser,
  insertFeedback,
  listRecentFeedback,
  setUserPending,
} from "../repo.js";
import { clipText, texts } from "../texts.js";
import { formatDateTime } from "../time.js";
import { replyDenied } from "./flow.js";

const MAX_FEEDBACK = 2000;

export async function beginFeedback(ctx: Context, body = ""): Promise<void> {
  const from = ctx.from;
  if (!from || from.is_bot || ctx.message?.sender_chat) return;
  const chatType = ctx.chat?.type;
  if (chatType === "group" || chatType === "supergroup") {
    const connected = await getGroupChatId();
    if (!connected || String(ctx.chat?.id) !== connected) return;
    const text = body.trim();
    if (!text) {
      await ctx.reply(texts.feedbackGroupUsage);
      return;
    }
    if (text.length > MAX_FEEDBACK) {
      await ctx.reply(texts.feedbackTooLong);
      return;
    }
    const access = await requireParticipantAccess({
      api: ctx.api,
      telegramId: String(from.id),
      name: displayName(from),
      username: from.username ?? null,
    });
    if (!access.ok) {
      await replyDenied(ctx, access);
      return;
    }
    await insertFeedback(access.user.id, text);
    await ctx.reply(texts.feedbackThanks);
    return;
  }
  if (chatType !== "private") return;
  const access = await requireParticipantAccess({
    api: ctx.api,
    telegramId: String(from.id),
    name: displayName(from),
    username: from.username ?? null,
  });
  if (!access.ok) {
    await replyDenied(ctx, access);
    return;
  }
  const user = access.user;
  const text = body.trim();
  if (text) {
    if (text.length > MAX_FEEDBACK) {
      await ctx.reply(texts.feedbackTooLong, memberMarkup(user.role));
      return;
    }
    await insertFeedback(user.id, text);
    await ctx.reply(texts.feedbackThanks, memberMarkup(user.role));
    return;
  }
  await setUserPending(user.id, "feedback");
  await ctx.reply(texts.feedbackAsk, memberMarkup(user.role));
}

export async function handleMemberButton(ctx: Context, bot?: { api: Context["api"] }): Promise<boolean> {
  if (ctx.chat?.type !== "private") return false;
  const text = ctx.message?.text;
  if (text === memberButtons.plan) {
    const { openPlan } = await import("./flow.js");
    await openPlan(ctx, (bot ?? ctx) as never);
    return true;
  }
  if (text === memberButtons.topic) {
    const { showMyTopic } = await import("./flow.js");
    await showMyTopic(ctx, (bot ?? ctx) as never);
    return true;
  }
  if (text !== memberButtons.feedback && text !== "Taklif") return false;
  await beginFeedback(ctx);
  return true;
}

/** Saves the next private text after Taklif. Returns true when that text was consumed. */
export async function captureFeedback(ctx: Context): Promise<boolean> {
  if (ctx.chat?.type !== "private") return false;
  const from = ctx.from;
  const text = ctx.message?.text?.trim();
  if (!from || !text) return false;
  const user = await findUser(String(from.id));
  if (user?.pending !== "feedback") return false;
  const access = await requireParticipantAccess({
    api: ctx.api,
    telegramId: String(from.id),
    name: displayName(from),
    username: from.username ?? null,
  });
  if (!access.ok) {
    await replyDenied(ctx, access);
    return true;
  }
  if (text.length > MAX_FEEDBACK) {
    await ctx.reply(texts.feedbackTooLong, memberMarkup(user.role));
    return true;
  }
  await insertFeedback(user.id, text);
  await setUserPending(user.id, null);
  await ctx.reply(texts.feedbackThanks, memberMarkup(user.role));
  return true;
}

export async function feedbackBoardText(): Promise<string> {
  const rows = await listRecentFeedback(15);
  if (rows.length === 0) return "💬 No feedback yet. Members can use the Taklif button or /feedback.";
  const blocks = rows.map((row) => {
    const who = profileLink(row.telegramId, row.name, row.username);
    const when = formatDateTime(config.timezone, row.createdAt);
    const body = escapeHtml(clipText(row.text, 400));
    return `${when}  ${who}\n${body}`;
  });
  return [`💬 Latest feedback (${rows.length})`, "", blocks.join("\n\n────────\n\n")].join("\n");
}
