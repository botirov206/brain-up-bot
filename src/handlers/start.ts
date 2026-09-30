import type { Bot, Context } from "grammy";
import { requireParticipantAccess } from "../access.js";
import { memberKeyboard } from "../admin-ui.js";
import { config, isConfiguredAdmin } from "../config.js";
import { logError } from "../log.js";
import { displayName } from "../names.js";
import { wakeCardBand } from "../accountability.js";
import { findUser, getDayNote, getDayPost, getSettings, recordWake, setUserPending, setWakeCard, upsertUser } from "../repo.js";
import { texts } from "../texts.js";
import { activeWakePayload, formatTime, todayDateString } from "../time.js";
import { replyDenied } from "./flow.js";
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
    makeAdmin: isConfiguredAdmin(telegramId),
    started: true,
  });

  const markup = { reply_markup: memberKeyboard };
  const withHint = (text: string) => `${text}\n\n${texts.feedbackHint}`;
  const welcome = texts.welcome;

  if ((payload === "wake" || payload.startsWith("wake_")) && !activeWakePayload(payload, config.timezone)) {
    if (first) await ctx.reply(welcome, markup);
    await ctx.reply(texts.wakeExpired, markup);
    return;
  }

  const access = await requireParticipantAccess({
    api: bot.api,
    telegramId,
    name: displayName(from),
    username: from.username ?? null,
    isBot: from.is_bot,
  });
  if (!access.ok) {
    await replyDenied(ctx, access);
    return;
  }

  if (payload === "explain" || payload.startsWith("explain_")) {
    const todayKey = todayDateString(config.timezone).replaceAll("-", "");
    if (payload !== "explain" && payload !== `explain_${todayKey}`) {
      await ctx.reply(texts.wakeExpired, markup);
      return;
    }
    if (first) await ctx.reply(welcome, markup);
    await beginExplain(ctx, user.id, user.role);
    return;
  }

  if (payload === "wake" || payload.startsWith("wake_")) {
    const today = todayDateString(config.timezone);
    if (!(await getDayPost(today, "wake"))) {
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
    const settings = await getSettings();
    const note = await getDayNote(user.id, today);
    const band = wakeCardBand(time, settings.on_time);
    if (band === "green") {
      if (note?.wakeCard !== "green") await setWakeCard(user.id, today, "green");
      await ctx.reply(withHint(`${wake.already ? texts.wakeAlready(time) : texts.wakeOk(time)}\n\n🟢 Muvaffaqiyatli.`), markup);
      return;
    }
    if (!note?.wakeCard && !note?.explanation) {
      await setUserPending(user.id, "explain", { date: today }, new Date(Date.now() + 18 * 60 * 60 * 1000));
      await ctx.reply(`${wake.already ? texts.wakeAlready(time) : texts.wakeOk(time)}\n\n${texts.explainAsk}`, markup);
      return;
    }
    await ctx.reply(withHint(wake.already ? texts.wakeAlready(time) : texts.wakeOk(time)), markup);
    return;
  }

  await ctx.reply(withHint(first ? welcome : texts.alreadyRegistered), markup);
}
