import type { Context } from "grammy";
import { wakeClass } from "../accountability.js";
import { memberMarkup } from "../admin-ui.js";
import { config } from "../config.js";
import {
  findUser,
  getDayNote,
  getDayPost,
  getSettings,
  saveExplanation,
  setUserPending,
} from "../repo.js";
import { texts } from "../texts.js";
import { todayDateString } from "../time.js";

const MAX_EXPLANATION = 2000;

export async function beginExplain(ctx: Context, userId: number, role: string): Promise<void> {
  const settings = await getSettings();
  const today = todayDateString(config.timezone);
  const note = await getDayNote(userId, today);
  const kind = wakeClass(config.timezone, note?.wakeUpAt ?? null, settings.on_time);
  const markup = memberMarkup(role);
  if (kind === "on_time") {
    await ctx.reply(texts.explainNotNeeded, markup);
    return;
  }
  if (note?.explanation) {
    await ctx.reply(texts.explainAlready, markup);
    return;
  }
  await setUserPending(userId, "explain");
  await ctx.reply(texts.explainAsk, markup);
}

export async function captureExplanation(ctx: Context): Promise<boolean> {
  if (ctx.chat?.type !== "private") return false;
  const from = ctx.from;
  const text = ctx.message?.text?.trim();
  if (!from || !text) return false;
  const user = await findUser(String(from.id));
  if (user?.pending !== "explain") return false;
  if (text.length > MAX_EXPLANATION) {
    await ctx.reply(texts.explainTooLong, memberMarkup(user.role));
    return true;
  }
  await saveExplanation(user.id, todayDateString(config.timezone), text);
  await setUserPending(user.id, null);
  await ctx.reply(texts.explainThanks, memberMarkup(user.role));
  return true;
}

/** A reply to today's group ask is the explanation, and it shows up for the admin. */
export async function captureGroupExplanation(ctx: Context): Promise<boolean> {
  const chatType = ctx.chat?.type;
  if (chatType !== "group" && chatType !== "supergroup") return false;
  const from = ctx.from;
  const text = ctx.message?.text?.trim();
  const replyId = ctx.message?.reply_to_message?.message_id;
  if (!from || !text || replyId === undefined) return false;
  const today = todayDateString(config.timezone);
  const postId = await getDayPost(today, "explain");
  if (postId !== replyId) return false;

  const user = await findUser(String(from.id));
  if (!user?.started_at) {
    await ctx.reply(texts.replyNeedStart);
    return true;
  }
  const settings = await getSettings();
  const note = await getDayNote(user.id, today);
  const kind = wakeClass(config.timezone, note?.wakeUpAt ?? null, settings.on_time);
  if (kind === "on_time") {
    await ctx.reply(texts.explainNotNeeded);
    return true;
  }
  if (text.length > MAX_EXPLANATION) {
    await ctx.reply(texts.explainTooLong);
    return true;
  }
  await saveExplanation(user.id, today, text);
  await ctx.reply(texts.explainThanks);
  return true;
}
