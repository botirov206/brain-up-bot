import type { Context } from "grammy";
import { memberButtons, memberMarkup } from "../admin-ui.js";
import { config } from "../config.js";
import { escapeHtml, profileLink } from "../html.js";
import { displayName } from "../names.js";
import {
  findUser,
  insertFeedback,
  listRecentFeedback,
  setUserPending,
  upsertUser,
} from "../repo.js";
import { clipText, texts } from "../texts.js";
import { formatDateTime } from "../time.js";

const MAX_FEEDBACK = 2000;

export async function beginFeedback(ctx: Context, body = ""): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  const chatType = ctx.chat?.type;
  if (chatType === "group" || chatType === "supergroup") {
    const text = body.trim();
    if (!text) {
      await ctx.reply(texts.feedbackGroupUsage);
      return;
    }
    if (text.length > MAX_FEEDBACK) {
      await ctx.reply(texts.feedbackTooLong);
      return;
    }
    const user = await upsertUser({
      telegramId: String(from.id),
      name: displayName(from),
      username: from.username ?? null,
      makeAdmin: config.adminIds.includes(String(from.id)),
      started: false,
    });
    await insertFeedback(user.id, text);
    await ctx.reply(texts.feedbackThanks);
    return;
  }
  if (chatType !== "private") return;
  const user = await findUser(String(from.id));
  if (!user?.started_at) {
    await ctx.reply(texts.replyNeedStart);
    return;
  }
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

export async function handleMemberButton(ctx: Context): Promise<boolean> {
  if (ctx.chat?.type !== "private") return false;
  if (ctx.message?.text !== memberButtons.feedback) return false;
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
