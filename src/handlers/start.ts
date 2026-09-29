import type { Bot, Context } from "grammy";
import { config } from "../config.js";
import { logError } from "../log.js";
import { displayName } from "../names.js";
import { findUser, recordWake, upsertStartedUser } from "../repo.js";
import { texts } from "../texts.js";
import { formatTime, todayDateString } from "../time.js";
import { upsertWakeCount } from "../jobs.js";

export async function handleStart(ctx: Context, bot: Bot, payload: string): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply(texts.startInGroup);
    return;
  }
  const from = ctx.from;
  if (!from) return;

  const telegramId = String(from.id);
  const existing = await findUser(telegramId);
  const first = !existing?.started_at;
  const user = await upsertStartedUser({
    telegramId,
    name: displayName(from),
    username: from.username ?? null,
    makeAdmin: config.adminIds.includes(telegramId),
  });

  if (payload === "wake") {
    const wake = await recordWake(user.id, todayDateString(config.timezone));
    const time = formatTime(config.timezone, wake.wakeUpAt);
    if (!wake.already) {
      try {
        await upsertWakeCount(bot);
      } catch (err) {
        logError("wake count", err);
      }
    }
    if (first) await ctx.reply(texts.welcome);
    await ctx.reply(wake.already ? texts.wakeAlready(time) : texts.wakeOk(time));
    return;
  }

  await ctx.reply(first ? texts.welcome : texts.alreadyRegistered);
}
