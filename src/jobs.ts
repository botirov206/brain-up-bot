import { InlineKeyboard, type Bot } from "grammy";
import cron, { type ScheduledTask } from "node-cron";
import { reconcileKnownMemberships } from "./access.js";
import { forumDestination, dispatchDailyTopics, collectDueAccountabilityCases, flushDeliveries } from "./challenge.js";
import { config } from "./config.js";
import { resolveGroupChatId } from "./group.js";
import { splitBlocks } from "./pages.js";
import { profileLink } from "./html.js";
import { logError, errorText } from "./log.js";
import {
  getDailyStats,
  getDayPost,
  getGroupChatId,
  getSettings,
  listStartedWakeTimes,
  removeWakePost,
  saveDayPost,
  wakePostsThrough,
  type Settings,
} from "./repo.js";
import { daySnapshot, hasPublishedPlan, listEligible, markSendingUncertain } from "./store.js";
import { texts } from "./texts.js";
import { formatTime, hhmmToCron, shiftDate, todayDateString, zonedTimeToUtc } from "./time.js";

let botRef: Bot | undefined;
let tasks: ScheduledTask[] = [];
let deliveryTimer: ReturnType<typeof setInterval> | undefined;

export async function startScheduler(bot: Bot): Promise<void> {
  botRef = bot;
  await markSendingUncertain();
  await reloadScheduler();
  await recoverDailyJobs(bot);
  deliveryTimer = setInterval(() => {
    void flushDeliveries(bot, 5).catch((err: unknown) => logError("delivery flush", err));
  }, 5000);
}

export function stopScheduler(): void {
  if (deliveryTimer) clearInterval(deliveryTimer);
  deliveryTimer = undefined;
  stopTasks();
}

export async function reloadScheduler(): Promise<void> {
  const bot = botRef;
  if (!bot) throw new Error("scheduler is not started");
  const settings = await getSettings();
  const next: ScheduledTask[] = [];
  try {
    next.push(schedule(settings.wake_time, "wake", () => runWakeNudge(bot)));
    next.push(schedule("12:00", "close wake", () => removeOldWakePosts(bot, todayDateString(config.timezone))));
    next.push(schedule(settings.topic_time, "topic", () => runTopicJob(bot)));
    next.push(schedule(settings.on_time, "missing wake", () => runMissingWakeReminder(bot)));
    next.push(schedule(settings.plan_deadline, "plan", () => runPlanReminder(bot)));
    next.push(schedule(settings.response_deadline, "response", () => runResponseReminder(bot)));
    next.push(schedule(settings.report_time, "report", () => runReportJob(bot)));
  } catch (err) {
    for (const task of next) void Promise.resolve(task.destroy());
    throw err;
  }
  stopTasks();
  tasks = next;
  console.log(
    `Scheduled wake ${settings.wake_time}, close wake 12:00, topic ${settings.topic_time}, missing-wake ${settings.on_time}, report ${settings.report_time} (${config.timezone})`,
  );
}

function schedule(hhmm: string, name: string, job: () => Promise<void>): ScheduledTask {
  return cron.schedule(
    hhmmToCron(hhmm),
    () => {
      void job().catch((err: unknown) => logError(`job ${name}`, err));
    },
    { timezone: config.timezone, name, noOverlap: true },
  );
}

function stopTasks(): void {
  const current = tasks;
  tasks = [];
  for (const task of current) {
    void Promise.resolve(task.destroy());
  }
}

async function requireGroup(label: string): Promise<string | null> {
  const chatId = await getGroupChatId();
  if (chatId) return chatId;
  console.error(`[job] ${label} skipped: no group. An admin sets it with /group <id>.`);
  return null;
}

export async function runWakeNudge(bot: Bot): Promise<void> {
  const date = todayDateString(config.timezone);
  console.log(`[job] wake ${date}`);
  await removeOldWakePosts(bot, shiftDate(date, -1));
  if (formatTime(config.timezone, new Date()) >= "12:00") {
    console.log("[job] wake skipped: morning check-in closes at 12:00");
    return;
  }
  if (await getDayPost(date, "wake")) return;
  const dest = await forumDestination("daily");
  if (!dest) {
    console.error("[job] wake skipped: daily topic is not bound");
    return;
  }
  const url = `https://t.me/${config.botUsername}?start=wake_${date.replaceAll("-", "")}`;
  const keyboard = new InlineKeyboard().url(texts.wakeButton, url);
  try {
    const sent = await bot.api.sendMessage(dest.chatId, texts.morningHello, {
      reply_markup: keyboard,
      message_thread_id: dest.topicId,
    });
    await saveDayPost(date, "wake", sent.message_id, { chatId: dest.chatId, topicId: dest.topicId });
    if (formatTime(config.timezone, new Date()) >= "12:00") await removeOldWakePosts(bot, date);
  } catch (err) {
    logError("wake nudge", err);
  }
  await upsertWakeCount(bot);
}

export async function removeOldWakePosts(bot: Bot, throughDate: string): Promise<void> {
  const posts = await wakePostsThrough(throughDate);
  for (const post of posts) {
    if (!post.chatId || post.messageId <= 0) continue;
    try {
      await bot.api.deleteMessage(post.chatId, post.messageId);
    } catch (deleteErr) {
      try {
        await bot.api.editMessageReplyMarkup(post.chatId, post.messageId, {
          reply_markup: { inline_keyboard: [] },
        });
      } catch (editErr) {
        const detail = errorText(editErr).toLowerCase();
        if (!detail.includes("message to edit not found") && !detail.includes("message is not modified")) {
          logError(`remove wake ${post.date}`, deleteErr);
          logError(`clear wake button ${post.date}`, editErr);
          continue;
        }
      }
    }
    await removeWakePost(post.date);
  }
}

/** Create or edit the single daily "N / M uyg'ondi" message. No names. */
export async function upsertWakeCount(bot: Bot): Promise<void> {
  const date = todayDateString(config.timezone);
  const dest = await forumDestination("daily");
  if (!dest) return;
  const stats = await getDailyStats(date);
  const text = texts.wakeCount(stats.wakes, stats.started);
  const existingId = await getDayPost(date, "wake_count");
  if (existingId !== null) {
    try {
      await bot.api.editMessageText(dest.chatId, existingId, text);
      return;
    } catch (err) {
      if (errorText(err).includes("message is not modified")) return;
      logError("edit wake count", err);
    }
  }
  try {
    const sent = await bot.api.sendMessage(dest.chatId, text, { message_thread_id: dest.topicId });
    await saveDayPost(date, "wake_count", sent.message_id, { chatId: dest.chatId, topicId: dest.topicId });
  } catch (err) {
    logError("post wake count", err);
  }
}

export async function runTopicJob(bot: Bot): Promise<void> {
  const date = todayDateString(config.timezone);
  console.log(`[job] topic ${date}`);
  if (!(await resolveGroupChatId(bot))) {
    console.error("[job] topic skipped: no accessible group. Check /group in the bot.");
    return;
  }
  const settings = await getSettings();
  if (!settings.topic_schedule_enabled) return;
  const chatId = await getGroupChatId();
  if (!chatId) return;
  await dispatchDailyTopics(bot, chatId, date);
}

export type ReportPost = "posted" | "missing" | "unreachable" | "unbound";

async function todayReportText(): Promise<string> {
  const date = todayDateString(config.timezone);
  const stats = await getDailyStats(date);
  return texts.report(date, stats.wakes, stats.replies, stats.started, stats.topicSent);
}

export async function postReport(bot: Bot): Promise<ReportPost> {
  const chatId = await resolveGroupChatId(bot);
  if (!chatId) return "missing";
  const dest = await forumDestination("daily");
  if (!dest) return "unbound";
  const text = await todayReportText();
  try {
    await bot.api.sendMessage(dest.chatId, text, { message_thread_id: dest.topicId });
    return "posted";
  } catch (err) {
    logError("report", err);
    return "unreachable";
  }
}

export async function runMissingWakeReminder(bot: Bot): Promise<void> {
  const date = todayDateString(config.timezone);
  console.log(`[job] missing wake ${date}`);
  if (await getDayPost(date, "wake_missing")) return;
  const dest = await forumDestination("reminders");
  if (!dest) {
    console.error("[job] missing wake skipped: reminders topic is not bound");
    return;
  }
  const eligible = new Set((await listEligible(dest.chatId)).filter((person) => person.startedAt).map((person) => person.telegramId));
  const missing = (await listStartedWakeTimes(date)).filter((person) => !person.wakeUpAt && eligible.has(person.telegramId));
  if (missing.length === 0) {
    console.log("[job] missing wake skipped: everyone who started has checked in");
    return;
  }
  const lines = ["🌅 Bugun «Uyg‘ondim»ni bosmaganlar:", "", ...missing.map((person) => profileLink(person.telegramId, person.name, person.username))];
  const chunks = splitBlocks(lines);
  try {
    for (let index = 0; index < chunks.length; index += 1) {
      const sent = await bot.api.sendMessage(dest.chatId, chunks[index] ?? "", {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        message_thread_id: dest.topicId,
      });
      await saveDayPost(date, "wake_missing", sent.message_id, { chatId: dest.chatId, topicId: dest.topicId, partIndex: index });
    }
  } catch (err) {
    logError("missing wake", err);
  }
}

export async function runPlanReminder(bot: Bot): Promise<void> {
  await remindMissing(bot, "plan", "plan_reminder");
}

export async function runResponseReminder(bot: Bot): Promise<void> {
  await remindMissing(bot, "topic_response", "response_reminder");
}

async function remindMissing(bot: Bot, requirement: "plan" | "topic_response", kind: string): Promise<void> {
  const date = todayDateString(config.timezone);
  if (await getDayPost(date, kind)) return;
  const dest = await forumDestination("reminders");
  if (!dest) return;
  await collectDueAccountabilityCases(dest.chatId, date, new Date());
  const mentions = await missingMentions(dest.chatId, date, requirement);
  if (mentions.length === 0) return;
  const title = requirement === "plan" ? "Bugungi rejasini hali yubormaganlar:" : "Mavzuga hali javob bermaganlar:";
  const chunks = splitBlocks([title, "", ...mentions]);
  for (let index = 0; index < chunks.length; index += 1) {
    const sent = await bot.api.sendMessage(dest.chatId, chunks[index] ?? "", {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      message_thread_id: dest.topicId,
    });
    await saveDayPost(date, kind, sent.message_id, { chatId: dest.chatId, topicId: dest.topicId, partIndex: index });
  }
  void bot;
}

async function missingMentions(chatId: string, date: string, requirement: "plan" | "topic_response"): Promise<string[]> {
  const settings = await getSettings();
  const deadline = zonedTimeToUtc(date, requirement === "plan" ? settings.plan_deadline : settings.response_deadline, config.timezone);
  const people = await listEligible(chatId);
  const lines: string[] = [];
  for (const person of people) {
    if (person.admittedAt && person.admittedAt.getTime() > deadline.getTime()) continue;
    if (requirement === "plan") {
      if (await hasPublishedPlan(person.id, date)) continue;
    } else {
      const snap = await daySnapshot(person.id, date);
      if (snap?.replyAt) continue;
      if (!snap?.forumPostedAt || snap.forumPostedAt.getTime() > deadline.getTime()) continue;
    }
    lines.push(profileLink(person.telegramId, person.name, person.username));
  }
  return lines;
}

export async function recoverDailyJobs(bot: Bot): Promise<void> {
  await reconcileKnownMemberships(bot.api);
  const now = formatTime(config.timezone, new Date());
  const today = todayDateString(config.timezone);
  await removeOldWakePosts(bot, now >= "12:00" ? today : shiftDate(today, -1));
  const settings = await getSettings();
  if (now < "12:00" && now >= settings.wake_time) await runWakeNudge(bot);
  if (settings.topic_schedule_enabled && now >= settings.topic_time) await runTopicJob(bot);
  if (now >= settings.on_time) await runMissingWakeReminder(bot);
  if (now >= settings.plan_deadline) await runPlanReminder(bot);
  if (now >= settings.response_deadline) await runResponseReminder(bot);
  if (now >= settings.report_time) await runReportJob(bot);
}

export async function runReportJob(bot: Bot): Promise<void> {
  const date = todayDateString(config.timezone);
  console.log(`[job] report ${date}`);
  if (await getDayPost(date, "report_auto")) return;
  const result = await postReport(bot);
  if (result === "posted") {
    const dest = await forumDestination("daily");
    if (dest) await saveDayPost(date, "report_auto", 0, { chatId: dest.chatId, topicId: dest.topicId });
  }
}

export function formatSettings(settings: Settings, groupChatId: string | null): string {
  return [
    `⏰ Schedule Settings (${config.timezone})`,
    `🌅 Morning button: ${settings.wake_time} ${settings.wake_time >= "12:00" ? "⚠️ set this before noon" : "(closes at 12:00)"}`,
    `✅ On-time deadline: ${settings.on_time} (later check-ins are late)`,
    `🧠 Topic sent: ${settings.topic_time}`,
    `📋 Plan deadline: ${settings.plan_deadline}`,
    `🎙 Response deadline: ${settings.response_deadline}`,
    `📊 Group report: ${settings.report_time}`,
    `⏳ Grace: ${settings.grace_minutes} min`,
    `🧠 Topic schedule: ${settings.topic_schedule_enabled ? "on" : "off"}`,
    `👥 Group ID: ${groupChatId ?? "not connected"}`,
    `Topics: daily ${settings.topic_daily_id ?? "unbound"}, unusual ${settings.topic_unusual_id ?? "unbound"}, reminders ${settings.topic_reminders_id ?? "unbound"}, exercises ${settings.topic_exercises_id ?? "unbound"}`,
    "",
    "✏️ Change a time: /settings wake 05:30",
    "Other keys: ontime, topic, plan, response, report.",
    "/settings grace 60 and /settings topics on|off.",
    "👥 Connect or switch groups: add the bot as an admin, then send /group inside that group.",
  ].join("\n");
}
