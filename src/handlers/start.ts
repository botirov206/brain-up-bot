import type { Bot, Context } from "grammy";
import { adminKeyboard, ensureAdminMenu, memberKeyboard } from "../admin-ui.js";
import { config } from "../config.js";
import { logError } from "../log.js";
import { displayName } from "../names.js";
import { findUser, getDayPost, recordWake, upsertUser } from "../repo.js";
import { texts } from "../texts.js";
import { activeWakePayload, formatTime, todayDateString } from "../time.js";
import { beginExplain } from "./explain.js";
import { upsertWakeCount } from "../jobs.js";

export async function handleStart(ctx: Context, bot: Bot, payload: string): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply(`${texts.startInGroup}\n👉 https://t.me/${config.botUsername}`);
    return;
  }
  const from = ctx.from;
  if (!from) return;

  const telegramId = String(from.id);
  const existing = await findUser(telegramId);
  const first = !existing?.started_at;
  const user = await upsertUser({
    telegramId,
    name: displayName(from),
    username: from.username ?? null,
    makeAdmin: config.adminIds.includes(telegramId),
    started: true,
  });

  const isAdminUser = user.role === "admin";
  const markup = { reply_markup: isAdminUser ? adminKeyboard : memberKeyboard };
  if (isAdminUser) await ensureAdminMenu(ctx.api, from.id);
  const withHint = (text: string) => (isAdminUser ? text : `${text}\n\n${texts.feedbackHint}`);
  const welcome = isAdminUser ? texts.adminWelcome : texts.welcome;

  if (payload === "explain") {
    if (first) await ctx.reply(welcome, markup);
    await beginExplain(ctx, user.id, user.role);
    return;
  }

  if (payload === "wake" || payload.startsWith("wake_")) {
    const today = todayDateString(config.timezone);
    if (!activeWakePayload(payload, config.timezone) || !(await getDayPost(today, "wake"))) {
      if (first) await ctx.reply(welcome, markup);
      await ctx.reply(texts.wakeExpired, markup);
      return;
    }
    const wake = await recordWake(user.id, today);
    const time = formatTime(config.timezone, wake.wakeUpAt);
    if (!wake.already) {
      try {
        await upsertWakeCount(bot);
      } catch (err) {
        logError("wake count", err);
      }
    }
    if (first) await ctx.reply(welcome, markup);
    await ctx.reply(withHint(wake.already ? texts.wakeAlready(time) : texts.wakeOk(time)), markup);
    return;
  }

  await ctx.reply(withHint(first ? welcome : isAdminUser ? texts.adminAlready : texts.alreadyRegistered), markup);
}
