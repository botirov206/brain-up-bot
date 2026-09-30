import type { Bot, Context } from "grammy";
import { requireParticipantAccess } from "../access.js";
import { recordTopicResponse } from "../challenge.js";
import { config } from "../config.js";
import { displayName } from "../names.js";
import { findUser, getDayStatus, type ReplyKind } from "../repo.js";
import { texts } from "../texts.js";
import { todayDateString } from "../time.js";
import { replyDenied } from "./flow.js";

type Incoming = { fileId: string; kind: ReplyKind };

function incomingMedia(ctx: Context): Incoming | null {
  const message = ctx.message;
  if (!message) return null;
  if (message.voice) return { fileId: message.voice.file_id, kind: "voice" };
  if (message.video_note) return { fileId: message.video_note.file_id, kind: "video_note" };
  if (message.audio) return { fileId: message.audio.file_id, kind: "audio" };
  if (message.video) return { fileId: message.video.file_id, kind: "video" };
  if (message.document?.mime_type?.startsWith("video/")) {
    return { fileId: message.document.file_id, kind: "video_file" };
  }
  return null;
}

export async function handleMedia(ctx: Context, bot: Bot): Promise<void> {
  const chatType = ctx.chat?.type;
  if (chatType !== "private" && chatType !== "group" && chatType !== "supergroup") return;
  const from = ctx.from;
  const media = incomingMedia(ctx);
  if (!from || from.is_bot || !media || ctx.message?.sender_chat) return;

  const access = await requireParticipantAccess({
    api: bot.api,
    telegramId: String(from.id),
    name: displayName(from),
    username: from.username ?? null,
  });
  if (!access.ok) {
    if (chatType === "private") await replyDenied(ctx, access);
    return;
  }

  const date = todayDateString(config.timezone);
  const result = await recordTopicResponse({
    bot,
    userId: access.user.id,
    date,
    fileId: media.fileId,
    kind: media.kind,
    source: chatType === "private" ? "private" : "forum",
    chatId: String(ctx.chat?.id ?? ""),
    messageId: ctx.message?.message_id ?? null,
    threadId: ctx.message?.message_thread_id ?? null,
  });
  if (result === "wrong_topic") return;
  if (result === "no_assignment") {
    await ctx.reply(texts.replyNoTopic);
    return;
  }
  if (result === "duplicate") {
    await ctx.reply(texts.replyAlready);
    return;
  }
  await ctx.reply(result === "accepted" ? texts.replyThanks : texts.replyGroupFailed);
}

export async function handleYoutube(ctx: Context, bot: Bot, url: string): Promise<boolean> {
  const from = ctx.from;
  const chatType = ctx.chat?.type;
  if (!from || from.is_bot || !chatType) return false;
  const access = await requireParticipantAccess({
    api: bot.api,
    telegramId: String(from.id),
    name: displayName(from),
    username: from.username ?? null,
  });
  if (!access.ok) return false;
  const result = await recordTopicResponse({
    bot,
    userId: access.user.id,
    date: todayDateString(config.timezone),
    fileId: url,
    kind: "youtube",
    source: chatType === "private" ? "private" : "forum",
    chatId: String(ctx.chat?.id ?? ""),
    messageId: ctx.message?.message_id ?? null,
    threadId: ctx.message?.message_thread_id ?? null,
    youtubeUrl: url,
  });
  if (result === "wrong_topic" || result === "no_assignment") return false;
  await ctx.reply(result === "duplicate" ? texts.replyAlready : texts.replyThanks);
  return true;
}

export async function nudgeIfWaiting(ctx: Context): Promise<void> {
  if (ctx.chat?.type !== "private") return;
  const from = ctx.from;
  if (!from) return;
  const user = await findUser(String(from.id));
  if (!user?.started_at) return;
  const status = await getDayStatus(user.id, todayDateString(config.timezone));
  if (!status?.topic_id && !status?.topic_sent_at) return;
  if (status?.reply_at) return;
  await ctx.reply(texts.replyWrongKind);
}
