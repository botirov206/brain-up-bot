import type { Bot, Context } from "grammy";
import { config } from "../config.js";
import { logError } from "../log.js";
import { displayName } from "../names.js";
import {
  claimReply,
  clearReply,
  findUser,
  getDayStatus,
  getGroupChatId,
  updateUserProfile,
  type ReplyKind,
} from "../repo.js";
import { texts } from "../texts.js";
import { todayDateString } from "../time.js";

type Incoming = { fileId: string; kind: ReplyKind };

function incomingMedia(ctx: Context): Incoming | null {
  const message = ctx.message;
  if (!message) return null;
  if (message.voice) return { fileId: message.voice.file_id, kind: "voice" };
  if (message.video_note) return { fileId: message.video_note.file_id, kind: "video_note" };
  if (message.audio) return { fileId: message.audio.file_id, kind: "audio" };
  return null;
}

export async function handleMedia(ctx: Context, bot: Bot): Promise<void> {
  if (ctx.chat?.type !== "private") return;
  const from = ctx.from;
  const media = incomingMedia(ctx);
  if (!from || !media) return;

  const user = await findUser(String(from.id));
  if (!user?.started_at) {
    await ctx.reply(texts.replyNeedStart);
    return;
  }

  const date = todayDateString(config.timezone);
  const name = displayName(from);
  await updateUserProfile(user.id, name, from.username ?? null);

  const status = await getDayStatus(user.id, date);
  if (!status?.topic_sent_at) {
    await ctx.reply(texts.replyNoTopic);
    return;
  }
  if (status.reply_at) {
    await ctx.reply(texts.replyAlready);
    return;
  }

  const dayId = await claimReply(user.id, date, media.fileId, media.kind);
  if (!dayId) {
    await ctx.reply(texts.replyAlready);
    return;
  }

  try {
    await publishReply(bot, name, media.fileId, media.kind);
  } catch (err) {
    logError("publish reply", err);
    try {
      await clearReply(dayId);
    } catch (clearErr) {
      logError("clear reply", clearErr);
    }
    await ctx.reply(texts.replyGroupFailed);
    return;
  }

  await ctx.reply(texts.replyThanks);
}

export async function nudgeIfWaiting(ctx: Context): Promise<void> {
  if (ctx.chat?.type !== "private") return;
  const from = ctx.from;
  if (!from) return;
  const user = await findUser(String(from.id));
  if (!user?.started_at) return;
  const status = await getDayStatus(user.id, todayDateString(config.timezone));
  if (!status?.topic_sent_at || status.reply_at) return;
  await ctx.reply(texts.replyWrongKind);
}

/**
 * Voice and audio keep a caption. Telegram video notes cannot, so the group
 * gets a text line and then the round video.
 */
async function publishReply(bot: Bot, name: string, fileId: string, kind: ReplyKind): Promise<void> {
  const caption = texts.groupReplyCaption(name);
  const chatId = await getGroupChatId();
  if (!chatId) throw new Error("group chat id is not set");
  if (kind === "voice") {
    await bot.api.sendVoice(chatId, fileId, { caption });
    return;
  }
  if (kind === "audio") {
    await bot.api.sendAudio(chatId, fileId, { caption });
    return;
  }
  const header = await bot.api.sendMessage(chatId, caption);
  try {
    await bot.api.sendVideoNote(chatId, fileId);
  } catch (err) {
    try {
      await bot.api.deleteMessage(chatId, header.message_id);
    } catch (deleteErr) {
      logError("delete video-note header", deleteErr);
    }
    throw err;
  }
}
