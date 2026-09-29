import { InlineKeyboard, type Bot } from "grammy";
import cron, { type ScheduledTask } from "node-cron";
import { peopleToAsk } from "./boards.js";
import { config } from "./config.js";
import { groupMemberCount, resolveGroupChatId } from "./group.js";
import { profileLink } from "./html.js";
import { logError, errorText } from "./log.js";
import {
  ensureDay,
  getDailyStats,
  getDayPost,
  getDayStatus,
  getGroupChatId,
  getSettings,
  listStartedUsers,
  markTopicSent,
  removeWakePost,
  saveDayPost,
  takeTodayTopic,
  wakePostsThrough,
  type Settings,
} from "./repo.js";
import { texts } from "./texts.js";
import { formatTime, hhmmToCron, shiftDate, todayDateString } from "./time.js";

let botRef: Bot | undefined;
let tasks: ScheduledTask[] = [];

export async function startScheduler(bot: Bot): Promise<void> {
  botRef = bot;
  await reloadScheduler();
  const today = todayDateString(config.timezone);
  await removeOldWakePosts(bot, formatTime(config.timezone, new Date()) >= "12:00" ? today : shiftDate(today, -1));
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
    next.push(schedule("12:00", "close wake", () => removeOldWakePosts(bot, todayDateString(config.timezone))));
    next.push(schedule(settings.topic_time, "topic", () => runTopicJob(bot)));
    next.push(schedule(settings.explain_time, "explain", () => runExplainJob(bot)));
    next.push(schedule(settings.report_time, "report", () => runReportJob(bot)));
  } catch (err) {
    for (const task of next) void Promise.resolve(task.destroy());
    throw err;
  }
  stopTasks();
  tasks = next;
  console.log(
    `Scheduled wake ${settings.wake_time}, close wake 12:00, topic ${settings.topic_time}, explain ${settings.explain_time}, report ${settings.report_time} (${config.timezone})`,
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
  const chatId = await requireGroup("wake");
  if (!chatId) return;
  const url = `https://t.me/${config.botUsername}?start=wake_${date.replaceAll("-", "")}`;
  const keyboard = new InlineKeyboard().url(texts.wakeButton, url);
  try {
    const sent = await bot.api.sendMessage(chatId, texts.morningHello, {
      reply_markup: keyboard,
    });
    await saveDayPost(date, "wake", sent.message_id);
    if (formatTime(config.timezone, new Date()) >= "12:00") await removeOldWakePosts(bot, date);
  } catch (err) {
    logError("wake nudge", err);
  }
  await upsertWakeCount(bot);
}

export async function removeOldWakePosts(bot: Bot, throughDate: string): Promise<void> {
  const posts = await wakePostsThrough(throughDate);
  if (posts.length === 0) return;
  const chatId = await requireGroup("wake cleanup");
  if (!chatId) return;
  for (const post of posts) {
    try {
      await bot.api.deleteMessage(chatId, post.messageId);
    } catch (deleteErr) {
      try {
        await bot.api.editMessageReplyMarkup(chatId, post.messageId, {
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
  const chatId = await requireGroup("wake count");
  if (!chatId) return;
  const stats = await getDailyStats(date);
  const text = texts.wakeCount(stats.wakes, stats.started);
  const existingId = await getDayPost(date, "wake_count");
  if (existingId !== null) {
    try {
      await bot.api.editMessageText(chatId, existingId, text);
      return;
    } catch (err) {
      if (errorText(err).includes("message is not modified")) return;
      logError("edit wake count", err);
    }
  }
  try {
    const sent = await bot.api.sendMessage(chatId, text);
    await saveDayPost(date, "wake_count", sent.message_id);
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

export type ReportPost = "posted" | "missing" | "unreachable";

async function todayReportText(): Promise<string> {
  const date = todayDateString(config.timezone);
  const stats = await getDailyStats(date);
  return texts.report(date, stats.wakes, stats.replies, stats.started, stats.topicSent);
}

export async function postReport(bot: Bot): Promise<ReportPost> {
  const chatId = await resolveGroupChatId(bot);
  if (!chatId) return "missing";
  const text = await todayReportText();
  try {
    await bot.api.sendMessage(chatId, text);
    return "posted";
  } catch (err) {
    logError("report", err);
    return "unreachable";
  }
}

export async function runExplainJob(bot: Bot): Promise<void> {
  const date = todayDateString(config.timezone);
  console.log(`[job] explain ${date}`);
  if (await getDayPost(date, "explain")) return;
  const chatId = await requireGroup("explain");
  if (!chatId) return;
  const settings = await getSettings();
  const people = await peopleToAsk(settings);
  if (people.length === 0) {
    console.log("[job] explain skipped: nobody late or missing among people who pressed Start");
    return;
  }
  const shown = people.slice(0, 40);
  const lines = [texts.explainGroup(settings.on_time), "", ...shown.map((person) => profileLink(person.telegramId, person.name, person.username))];
  if (people.length > shown.length) lines.push(`… va yana ${people.length - shown.length} kishi`);
  const members = await groupMemberCount(bot);
  if (members !== null) {
    lines.push("", `Bot faqat Start bosganlarni ko'radi. Guruhda ${members} a'zo, bot ${people.length} kishini so'rayapti.`);
  }
  const keyboard = new InlineKeyboard().url(texts.explainButton, `https://t.me/${config.botUsername}?start=explain`);
  try {
    const sent = await bot.api.sendMessage(chatId, lines.join("\n"), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: keyboard,
    });
    await saveDayPost(date, "explain", sent.message_id);
  } catch (err) {
    logError("explain ask", err);
  }
}

export async function runReportJob(bot: Bot): Promise<void> {
  console.log(`[job] report ${todayDateString(config.timezone)}`);
  await postReport(bot);
}

export function formatSettings(settings: Settings, groupChatId: string | null): string {
  return [
    `⏰ Schedule Settings (${config.timezone})`,
    `🌅 Morning button: ${settings.wake_time} ${settings.wake_time >= "12:00" ? "⚠️ set this before noon" : "(closes at 12:00)"}`,
    `✅ On-time deadline: ${settings.on_time} (later check-ins are late)`,
    `🧠 Topic sent: ${settings.topic_time}`,
    `📝 Ask for reasons: ${settings.explain_time}`,
    `📊 Group report: ${settings.report_time}`,
    `👥 Group ID: ${groupChatId ?? "not connected"}`,
    "",
    "✏️ Change a time: /settings wake 05:30",
    "Other keys: ontime, topic, explain, report.",
    "👥 Connect or switch groups: add the bot as an admin, then send /group inside that group.",
  ].join("\n");
}
