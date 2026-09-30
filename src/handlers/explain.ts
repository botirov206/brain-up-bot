import { InlineKeyboard, type Bot, type Context } from "grammy";
import { cardLimitsReached, wakeCardBand, wakeClass, type WakeCard } from "../accountability.js";
import { memberMarkup } from "../admin-ui.js";
import { config } from "../config.js";
import { requireParticipantAccess } from "../access.js";
import { profileLink } from "../html.js";
import { displayName } from "../names.js";
import {
  countWakeCards,
  explanationOwner,
  findUser,
  getDayNote,
  getSettings,
  listDayPosts,
  saveExplanation,
  setUserPending,
  setWakeCard,
} from "../repo.js";
import { clearBlocked, setBlocked } from "../store.js";
import { replyDenied } from "./flow.js";
import { texts } from "../texts.js";
import { addMinutes, formatTime, todayDateString } from "../time.js";

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
  await setUserPending(userId, "explain", { date: today }, new Date(Date.now() + 18 * 60 * 60 * 1000));
  await ctx.reply(texts.explainAsk, markup);
}

export async function captureExplanation(ctx: Context): Promise<boolean> {
  if (ctx.chat?.type !== "private") return false;
  const from = ctx.from;
  const text = ctx.message?.text?.trim();
  if (!from || !text) return false;
  const found = await findUser(String(from.id));
  if (found?.pending !== "explain") return false;
  const payload = found.pending_payload as { date?: string } | null;
  if (payload?.date && payload.date !== todayDateString(config.timezone)) return false;
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
  const user = access.user;
  if (text.length > MAX_EXPLANATION) {
    await ctx.reply(texts.explainTooLong, memberMarkup(user.role));
    return true;
  }
  const today = todayDateString(config.timezone);
  const note = await getDayNote(user.id, today);
  await saveExplanation(user.id, today, text);
  await setUserPending(user.id, null);
  await notifyAdmins(ctx.api, user.id, today, text, note?.wakeUpAt ? formatTime(config.timezone, note.wakeUpAt) : formatTime(config.timezone, new Date()));
  await ctx.reply(texts.explainThanks, memberMarkup(user.role));
  return true;
}

async function notifyAdmins(api: Context["api"], userId: number, date: string, reason: string, time: string): Promise<void> {
  const owner = await explanationOwner(userId, date);
  if (!owner) return;
  const who = profileLink(owner.telegramId, owner.name, owner.username);
  const settings = await getSettings();
  const band = wakeCardBand(time, settings.on_time);
  const lateCard = band === "red" ? "red" : "orange";
  const keyboard = cardKeyboard(userId, date, lateCard);
  const fresh = owner.startedAt && Date.now() - owner.startedAt.getTime() < 7 * 24 * 60 * 60 * 1000 ? "\nYangi ishtirokchi — sariq mos kelishi mumkin." : "";
  const cutoff = addMinutes(settings.on_time, 60) ?? settings.on_time;
  const bandLabel = lateCard === "red" ? `🔴 ${cutoff} dan keyin` : `🟠 ${settings.on_time}–${cutoff}`;
  const body = `🕒 Kech turish\n${who}\nVaqt: ${time}\n${bandLabel}${fresh}\n\n${reason}`;
  for (const adminId of config.adminIds) {
    try {
      await api.sendMessage(adminId, body, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: keyboard,
      });
    } catch {
      // An admin who has not opened the bot cannot be notified.
    }
  }
}

export async function reviewLateReason(ctx: Context, bot: Bot, userId: number, compactDate: string, card: WakeCard | "late"): Promise<void> {
  if (!Number.isInteger(userId) || !/^\d{8}$/.test(compactDate)) return;
  const date = `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`;
  const owner = await explanationOwner(userId, date);
  if (!owner?.wakeUpAt) {
    await ctx.reply("Bu sabab topilmadi.");
    return;
  }
  const settings = await getSettings();
  const time = formatTime(config.timezone, owner.wakeUpAt);
  const band = wakeCardBand(time, settings.on_time);
  const lateCard = band === "red" ? "red" : "orange";
  const chosenCard = card === "late" ? lateCard : card;
  if (chosenCard !== "yellow" && chosenCard !== lateCard) return;
  await setWakeCard(userId, date, chosenCard);
  const counts = await countWakeCards(userId);
  const limit = cardLimitsReached(counts);
  const adminId = ctx.from?.id;
  if (limit && adminId) await setBlocked(userId, String(adminId), "wake-cards");
  if (!limit && owner.blockReason === "wake-cards") await clearBlocked(userId);
  const note = userCardNote(chosenCard, counts, limit);
  try {
    await bot.api.sendMessage(owner.telegramId, note);
  } catch {
    // The card is saved even if the private chat is closed.
  }
  const who = profileLink(owner.telegramId, owner.name, owner.username);
  const chosen = chosenCard === "yellow" ? "🟡 Sababli" : chosenCard === "red" ? "🔴 Uxlab qolgan" : "🟠 Kechikkan";
  try {
    await ctx.editMessageText(`${chosen}\n${who}\nVaqt: ${time}\n\nXato bosilgan bo‘lsa, boshqa statusni bosing.`, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: cardKeyboard(userId, date, lateCard),
    });
  } catch {
    await ctx.reply(`${chosen}. ${owner.name}`);
  }
}

function cardKeyboard(userId: number, date: string, lateCard: "orange" | "red"): InlineKeyboard {
  const compact = date.replaceAll("-", "");
  const late = lateCard === "red" ? "🔴 Uxlab qolgan" : "🟠 Kechikkan";
  return new InlineKeyboard().text(late, `wc:${userId}:${compact}:${lateCard}`).text("🟡 Sababli", `wc:${userId}:${compact}:yellow`);
}

function userCardNote(card: WakeCard, counts: { red: number; orange: number }, limit: "red" | "orange" | null): string {
  if (card === "yellow") return "🟡 Sababingiz qabul qilindi. Bugun sariq status. Qo‘shimcha kartochka yo‘q.";
  if (card === "green") return "🟢 Bugun o‘z vaqtida. Muvaffaqiyatli.";
  const line = card === "red"
    ? `🔴 Bugun uxlab qolgan deb belgilandingiz. Qizil kartochka: ${counts.red}/3.`
    : `🟠 Bugun kechikkan deb belgilandingiz. Olovrang kartochka: ${counts.orange}/5.`;
  if (limit === "red") return `${line}\n3 ta qizil kartochka to‘plandi. Challenge tark etildi.`;
  if (limit === "orange") return `${line}\n5 ta olovrang kartochka to‘plandi. Challenge tark etildi.`;
  return line;
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
  const posts = await listDayPosts(today, "explain");
  const post = posts.find((item) => item.messageId === replyId);
  if (!post || post.chatId !== String(ctx.chat?.id)) return false;
  if (post.topicId != null && ctx.message?.message_thread_id !== post.topicId) return false;

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
  const user = access.user;
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
  await notifyAdmins(ctx.api, user.id, today, text, note?.wakeUpAt ? formatTime(config.timezone, note.wakeUpAt) : "");
  await ctx.reply(texts.explainThanks);
  return true;
}
