import type { Bot } from "grammy";
import { chooseAssignments } from "./assign.js";
import { config } from "./config.js";
import { shouldOpenCase, type Requirement } from "./decisions.js";
import { errorText } from "./log.js";
import {
  claimReply,
  getGroupChatId,
  getSettings,
  markReplyPublishFailed,
  markReplyPublished,
  topicId,
  type ReplyKind,
  type TopicSlot,
} from "./repo.js";
import {
  assignmentsForDate,
  countEligible,
  daySnapshot,
  distributionStarted,
  enqueueDelivery,
  ensureObligationDay,
  hasPublishedPlan,
  insertCase,
  listAssignmentCards,
  listEligible,
  listTopicOptions,
  markDistributionStarted,
  markForumDelivery,
  markForumPosted,
  markPrivateDelivery,
  recentTopicIds,
  resolveCaseByRequirement,
  saveAssignment,
} from "./store.js";
import { texts } from "./texts.js";
import { todayDateString, zonedTimeToUtc } from "./time.js";
import { canonicalYoutubeUrl } from "./youtube.js";

export async function forumDestination(slot: TopicSlot): Promise<{ chatId: string; topicId: number } | null> {
  const [settings, chatId] = await Promise.all([getSettings(), getGroupChatId()]);
  const threadId = topicId(settings, slot);
  if (!chatId || threadId == null) return null;
  return { chatId, topicId: threadId };
}

export async function assignDailyTopics(chatId: string, date: string): Promise<number> {
  const [people, topics, already] = await Promise.all([
    listEligible(chatId),
    listTopicOptions(),
    assignmentsForDate(chatId, date),
  ]);
  const recent = new Map<number, number[]>();
  for (const person of people) {
    if (already.has(person.id)) continue;
    recent.set(person.id, await recentTopicIds(person.id, date));
  }
  const chosen = chooseAssignments({
    participantIds: people.map((person) => person.id),
    topics,
    recentByUser: recent,
    already,
  });
  let saved = 0;
  for (const person of people) {
    const topic = chosen.get(person.id);
    if (!topic || already.has(person.id)) continue;
    await saveAssignment(person.id, chatId, date, topic);
    saved += 1;
  }
  return saved;
}

export async function dispatchDailyTopics(bot: Bot, chatId: string, date: string): Promise<void> {
  const dest = await forumDestination("unusual");
  if (!dest || dest.chatId !== chatId) {
    console.error("[job] topic skipped: unusual topic is not bound");
    return;
  }
  await assignDailyTopics(chatId, date);
  await markDistributionStarted(chatId, date);
  const cards = await listAssignmentCards(chatId, date);
  for (const card of cards) {
    const forumKey = `topic-forum:${chatId}:${date}:${card.userId}`;
    if (card.forumStatus !== "published") {
      await enqueueDelivery({
        logicalKey: forumKey,
        operation: "topic_forum",
        subject: String(card.userId),
        chatId: dest.chatId,
        topicId: dest.topicId,
        payload: { userId: card.userId, date, text: texts.topicForum(card.name, card.topicText) },
      });
    }
    const privateKey = `topic-private:${chatId}:${date}:${card.userId}`;
    if (card.startedAt && card.privateStatus !== "sent") {
      await enqueueDelivery({
        logicalKey: privateKey,
        operation: "topic_private",
        subject: String(card.userId),
        chatId: card.telegramId,
        topicId: null,
        payload: { userId: card.userId, date, text: texts.topicDm(date, card.topicText) },
      });
    } else if (!card.startedAt) {
      await markPrivateDelivery(card.userId, date, "skipped");
    }
  }
  await flushDeliveries(bot, 30);
}

export async function recordTopicResponse(input: {
  bot: Bot;
  userId: number;
  date: string;
  fileId: string;
  kind: ReplyKind;
  source: "private" | "forum";
  chatId?: string | null;
  messageId?: number | null;
  threadId?: number | null;
  youtubeUrl?: string | null;
}): Promise<"accepted" | "duplicate" | "no_assignment" | "wrong_topic"> {
  if (input.source === "forum") {
    const dest = await forumDestination("unusual");
    if (!dest || input.chatId !== dest.chatId || input.threadId !== dest.topicId) return "wrong_topic";
  }
  const claim = await claimReply(input.userId, input.date, input.fileId, input.kind, input.source, {
    chatId: input.chatId,
    messageId: input.messageId,
    youtubeUrl: input.youtubeUrl,
  });
  if (!claim) return "no_assignment";
  if (claim.duplicate) return "duplicate";
  if (input.source === "forum") {
    await markReplyPublished(claim.dayId, input.messageId ?? 0, input.chatId ?? "");
  } else {
    const dest = await forumDestination("unusual");
    if (!dest) {
      await markReplyPublishFailed(claim.dayId, "unusual topic is not bound");
    } else {
      await enqueueDelivery({
        logicalKey: `reply:${input.userId}:${input.date}`,
        operation: "reply",
        subject: String(input.userId),
        chatId: dest.chatId,
        topicId: dest.topicId,
        payload: {
          dayId: claim.dayId,
          fileId: input.fileId,
          kind: input.kind,
          youtubeUrl: input.youtubeUrl,
          date: input.date,
        },
      });
      await flushDeliveries(input.bot, 5);
    }
  }
  const settings = await getSettings();
  const deadline = zonedTimeToUtc(input.date, settings.response_deadline, config.timezone);
  await resolveCaseByRequirement(input.userId, input.date, "topic_response", Date.now() > deadline.getTime());
  return "accepted";
}

export function youtubeFromText(text: string): string | null {
  return canonicalYoutubeUrl(text) ?? null;
}

export async function collectDueAccountabilityCases(chatId: string, date: string, now: Date): Promise<number> {
  const settings = await getSettings();
  const people = await listEligible(chatId);
  let opened = 0;
  const deadlines: Array<{ requirement: Requirement; at: string }> = [
    { requirement: "wake", at: "12:00" },
    { requirement: "plan", at: settings.plan_deadline },
    { requirement: "topic_response", at: settings.response_deadline },
  ];
  for (const person of people) {
    for (const item of deadlines) {
      const deadline = zonedTimeToUtc(date, item.at, config.timezone);
      if (now.getTime() < deadline.getTime()) continue;
      const snap = await daySnapshot(person.id, date);
      const publishedPlan = await hasPublishedPlan(person.id, date);
      const met =
        item.requirement === "wake"
          ? snap?.wakeUpAt != null
          : item.requirement === "plan"
            ? publishedPlan
            : snap?.replyAt != null;
      const open = shouldOpenCase({
        requirement: item.requirement,
        membership: "member",
        blocked: false,
        admittedAt: person.admittedAt ?? snap?.admittedAt ?? null,
        deadline,
        met,
        assignmentPostedAt: item.requirement === "topic_response" ? snap?.forumPostedAt ?? null : null,
      });
      if (!open) continue;
      const dayId = snap?.dayId ?? (await ensureObligationDay(person.id, chatId, date));
      await insertCase({
        dayId,
        userId: person.id,
        requirement: item.requirement,
        deadline,
        graceExpires: new Date(deadline.getTime() + settings.grace_minutes * 60_000),
        remindedAt: now,
        snapshot: {
          admittedAt: person.admittedAt?.toISOString() ?? null,
          deadline: deadline.toISOString(),
          requirement: item.requirement,
        },
      });
      opened += 1;
    }
  }
  return opened;
}

export async function participantTotal(chatId: string | null): Promise<number> {
  if (!chatId) return 0;
  return countEligible(chatId);
}

type DeliveryApi = Bot["api"];

let lastGroupSend = 0;

export async function flushDeliveries(bot: Bot, limit: number): Promise<void> {
  const { claimDueDelivery, completeDelivery, failDelivery, rescheduleDelivery } = await import("./store.js");
  const { classifySendError } = await import("./decisions.js");
  for (let index = 0; index < limit; index += 1) {
    const row = await claimDueDelivery();
    if (!row || !row.chatId) {
      if (row) await failDelivery(row.id, "missing destination", false);
      if (!row) return;
      continue;
    }
    if (row.topicId == null && row.operation !== "topic_private" && row.operation !== "announcement" && row.operation !== "topic_run") {
      if (row.operation !== "topic_private") {
        await failDelivery(row.id, "missing forum topic", false);
        continue;
      }
    }
    try {
      await pace(row.operation !== "topic_private" && row.operation !== "announcement");
      const messageId = await performDelivery(bot.api, row);
      await completeDelivery(row.id, messageId);
      await afterDelivery(row, messageId);
    } catch (err) {
      const failure = classifySendError(err, row.attempts);
      const message = errorText(err);
      if (failure.kind === "retry") await rescheduleDelivery(row.id, failure.delayMs, message);
      else {
        await failDelivery(row.id, message, failure.kind === "uncertain");
        const userId = Number(row.payload.userId ?? row.subject);
        const date = typeof row.payload.date === "string" ? row.payload.date : todayDateString(config.timezone);
        if (Number.isInteger(userId) && row.operation === "topic_forum") {
          await markForumDelivery(userId, date, failure.kind === "uncertain" ? "uncertain" : "failed");
        }
        if (Number.isInteger(userId) && row.operation === "topic_private") {
          await markPrivateDelivery(userId, date, failure.kind === "uncertain" ? "uncertain" : "failed");
        }
      }
      if (/blocked by the user|bot was blocked/i.test(message) && row.chatId && row.operation === "topic_private") {
        const { setPrivateReachable } = await import("./store.js");
        await setPrivateReachable(row.chatId, false);
      }
    }
  }
}

async function pace(group: boolean): Promise<void> {
  if (!group) return;
  const wait = 3000 - (Date.now() - lastGroupSend);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastGroupSend = Date.now();
}

function markupFrom(payload: Record<string, unknown>): { inline_keyboard: { text: string; callback_data: string }[][] } | undefined {
  const markup = payload.markup;
  if (!markup || typeof markup !== "object" || !("inline_keyboard" in markup)) return undefined;
  return markup as { inline_keyboard: { text: string; callback_data: string }[][] };
}

async function performDelivery(api: DeliveryApi, row: { operation: string; chatId: string | null; topicId: number | null; payload: Record<string, unknown> }): Promise<number | null> {
  const chatId = row.chatId;
  if (!chatId) throw new Error("missing chat");
  const thread = row.topicId == null ? {} : { message_thread_id: row.topicId };
  const text = typeof row.payload.text === "string" ? row.payload.text : "";
  if (row.operation === "topic_forum" || row.operation === "topic_private" || row.operation === "reminder" || row.operation === "report" || row.operation === "judgment" || row.operation === "announcement" || row.operation === "wake" || row.operation === "wake_count" || row.operation === "plan_forum" || row.operation === "plan_private") {
    const sent = await api.sendMessage(chatId, text, {
      ...thread,
      link_preview_options: { is_disabled: true },
      parse_mode: row.payload.html === true ? "HTML" : undefined,
      ...(markupFrom(row.payload) ? { reply_markup: markupFrom(row.payload) } : {}),
    });
    return sent.message_id;
  }
  if (row.operation === "plan_edit") {
    const messageId = Number(row.payload.messageId);
    const markup = markupFrom(row.payload);
    await api.editMessageText(chatId, messageId, text, {
      link_preview_options: { is_disabled: true },
      parse_mode: row.payload.html === true ? "HTML" : undefined,
      ...(markup ? { reply_markup: markup } : {}),
    });
    return messageId;
  }
  if (row.operation === "reply") {
    return publishReply(api, chatId, row.topicId, row.payload);
  }
  if (row.operation === "topic_run") return null;
  throw new Error(`unknown delivery ${row.operation}`);
}

async function publishReply(api: DeliveryApi, chatId: string, topicId: number | null, payload: Record<string, unknown>): Promise<number> {
  const thread = topicId == null ? {} : { message_thread_id: topicId };
  const kind = String(payload.kind ?? "");
  const fileId = String(payload.fileId ?? "");
  const caption = texts.groupReplyCaption(String(payload.name ?? "Ishtirokchi"));
  if (kind === "youtube") {
    const sent = await api.sendMessage(chatId, `${caption}\n${String(payload.youtubeUrl ?? fileId)}`, {
      ...thread,
      link_preview_options: { is_disabled: false },
    });
    return sent.message_id;
  }
  if (kind === "voice") {
    const sent = await api.sendVoice(chatId, fileId, { caption, ...thread });
    return sent.message_id;
  }
  if (kind === "audio") {
    const sent = await api.sendAudio(chatId, fileId, { caption, ...thread });
    return sent.message_id;
  }
  if (kind === "video") {
    const sent = await api.sendVideo(chatId, fileId, { caption, ...thread });
    return sent.message_id;
  }
  if (kind === "video_file") {
    const sent = await api.sendDocument(chatId, fileId, { caption, ...thread });
    return sent.message_id;
  }
  const header = await api.sendMessage(chatId, caption, thread);
  await api.sendVideoNote(chatId, fileId, thread);
  return header.message_id;
}

async function afterDelivery(
  row: { operation: string; payload: Record<string, unknown>; subject: string | null; chatId: string | null; topicId: number | null },
  messageId: number | null,
): Promise<void> {
  const userId = Number(row.payload.userId ?? row.subject);
  const date = typeof row.payload.date === "string" ? row.payload.date : todayDateString(config.timezone);
  if (Number.isInteger(userId) && row.operation === "topic_forum") await markForumPosted(userId, date);
  if (Number.isInteger(userId) && row.operation === "topic_private") await markPrivateDelivery(userId, date, "sent");
  if (row.operation === "reply" && messageId != null && row.chatId) {
    const dayId = Number(row.payload.dayId);
    if (Number.isInteger(dayId)) await markReplyPublished(dayId, messageId, row.chatId);
  }
  if ((row.operation === "plan_forum" || row.operation === "plan_private") && messageId != null && row.chatId) {
    const { rememberPlanMessage } = await import("./store.js");
    const planId = Number(row.payload.planId);
    if (Number.isInteger(planId)) {
      await rememberPlanMessage(planId, row.operation === "plan_private" ? "private" : "forum", row.chatId, messageId, row.topicId);
    }
  }
}

export async function noteForumFailure(userId: number, date: string): Promise<void> {
  await markForumDelivery(userId, date, "failed");
}

export async function todayIso(): Promise<string> {
  return todayDateString(config.timezone);
}
