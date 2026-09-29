import { InlineKeyboard, type Bot } from "grammy";
import cron, { type ScheduledTask } from "node-cron";
import { config } from "./config.js";
import { logError, errorText } from "./log.js";
import {
  ensureDay,
  getDailyStats,
  getDayPost,
  getDayStatus,
  getSettings,
  listStartedUsers,
  markTopicSent,
  saveDayPost,
  takeTodayTopic,
  type Settings,
} from "./repo.js";
import { texts } from "./texts.js";
import { hhmmToCron, todayDateString } from "./time.js";

let botRef: Bot | undefined;
let tasks: ScheduledTask[] = [];

export async function startScheduler(bot: Bot): Promise<void> {
  botRef = bot;
  await reloadScheduler();
}

export function stopScheduler(): void {
  stopTasks();
}

export async function reloadScheduler(): Promise<void> {
  const bot = botRef;
  if (!bot) throw new Error("scheduler is not started");
  const settings = await getSettings();
  const next: ScheduledTask[] = [];
  try {
    next.push(schedule(settings.wake_time, "wake", () => runWakeNudge(bot)));
    next.push(schedule(settings.topic_time, "topic", () => runTopicJob(bot)));
    next.push(schedule(settings.report_time, "report", () => runReportJob(bot)));
  } catch (err) {
    for (const task of next) void Promise.resolve(task.destroy());
    throw err;
  }
  stopTasks();
  tasks = next;
  console.log(
    `Scheduled wake ${settings.wake_time}, topic ${settings.topic_time}, report ${settings.report_time} (${config.timezone})`,
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

export async function runWakeNudge(bot: Bot): Promise<void> {
  const date = todayDateString(config.timezone);
  console.log(`[job] wake ${date}`);
  const url = `https://t.me/${config.botUsername}?start=wake`;
  const keyboard = new InlineKeyboard().url(texts.wakeButton, url);
  try {
    await bot.api.sendMessage(config.groupChatId, texts.morningHello, {
      reply_markup: keyboard,
    });
  } catch (err) {
    logError("wake nudge", err);
  }
  await upsertWakeCount(bot);
}

/** Create or edit the single daily "N / M uyg'ondi" message. No names. */
export async function upsertWakeCount(bot: Bot): Promise<void> {
  const date = todayDateString(config.timezone);
  const stats = await getDailyStats(date);
  const text = texts.wakeCount(stats.wakes, stats.started);
  const existingId = await getDayPost(date, "wake_count");
  if (existingId !== null) {
    try {
      await bot.api.editMessageText(config.groupChatId, existingId, text);
      return;
    } catch (err) {
      if (errorText(err).includes("message is not modified")) return;
      logError("edit wake count", err);
    }
  }
  try {
    const sent = await bot.api.sendMessage(config.groupChatId, text);
    await saveDayPost(date, "wake_count", sent.message_id);
  } catch (err) {
    logError("post wake count", err);
  }
}

export async function runTopicJob(bot: Bot): Promise<void> {
  const date = todayDateString(config.timezone);
  console.log(`[job] topic ${date}`);
  const topic = await takeTodayTopic(date);
  if (!topic) {
    console.error("[job] topic skipped: no topics in the bank. Add one with /topics add.");
    return;
  }

  const users = await listStartedUsers();
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const user of users) {
    const status = await getDayStatus(user.id, date);
    if (status?.topic_sent_at) {
      skipped += 1;
      continue;
    }
    await ensureDay(user.id, date);
    try {
      await bot.api.sendMessage(user.telegram_id, texts.topicDm(date, topic.text), {
        link_preview_options: { is_disabled: true },
      });
    } catch (err) {
      failed += 1;
      logError(`topic to ${user.telegram_id}`, err);
      continue;
    }
    await markTopicSent(user.id, date, topic.id);
    sent += 1;
  }
  console.log(`[job] topic id=${topic.id} sent=${sent} skipped=${skipped} failed=${failed}`);
}

export async function postReport(bot: Bot): Promise<boolean> {
  const date = todayDateString(config.timezone);
  const stats = await getDailyStats(date);
  const text = texts.report(date, stats.wakes, stats.replies, stats.started);
  try {
    await bot.api.sendMessage(config.groupChatId, text);
    return true;
  } catch (err) {
    logError("report", err);
    return false;
  }
}

export async function runReportJob(bot: Bot): Promise<void> {
  console.log(`[job] report ${todayDateString(config.timezone)}`);
  await postReport(bot);
}

export function formatSettings(settings: Settings): string {
  return [
    `Times (${config.timezone})`,
    `wake: ${settings.wake_time}`,
    `topic: ${settings.topic_time}`,
    `report: ${settings.report_time}`,
    "",
    "Change: /settings wake 05:30",
    "        /settings topic 08:00",
    "        /settings report 21:30",
  ].join("\n");
}
