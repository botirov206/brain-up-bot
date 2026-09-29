import type { Bot, Context } from "grammy";
import { topicAddText } from "../commands.js";
import { config } from "../config.js";
import { formatSettings, postReport, reloadScheduler } from "../jobs.js";
import { findUser } from "../repo.js";
import {
  getDailyStats,
  getSettings,
  insertTopic,
  listRecentTopics,
  updateSetting,
  type SettingKey,
} from "../repo.js";
import { MAX_TOPIC_LENGTH } from "../texts.js";
import { parseHHmm, todayDateString } from "../time.js";

function isSettingKey(value: string): value is SettingKey {
  return value === "wake" || value === "topic" || value === "report";
}

async function isAdmin(telegramId: number): Promise<boolean> {
  if (config.adminIds.includes(String(telegramId))) return true;
  const user = await findUser(String(telegramId));
  return user?.role === "admin";
}

export async function handleAdminCommand(
  ctx: Context,
  bot: Bot,
  name: string,
  body: string,
): Promise<void> {
  const chatType = ctx.chat?.type;
  if (chatType !== "private" && chatType !== "group" && chatType !== "supergroup") return;
  const from = ctx.from;
  if (!from) return;
  if (!(await isAdmin(from.id))) {
    await ctx.reply("Admins only.");
    return;
  }

  switch (name) {
    case "settings":
      await handleSettings(ctx, body);
      return;
    case "topics":
    case "topicadd":
      await handleTopics(ctx, name, body);
      return;
    case "report": {
      const posted = await postReport(bot);
      await ctx.reply(posted ? "Posted today's recap to the group." : "Could not post the recap. Check the logs.");
      return;
    }
    case "members":
      await handleMembers(ctx);
      return;
    default:
      return;
  }
}

async function handleSettings(ctx: Context, body: string): Promise<void> {
  if (!body) {
    await ctx.reply(formatSettings(await getSettings()));
    return;
  }
  const parts = body.split(/\s+/);
  const key = parts[0]?.toLowerCase() ?? "";
  const value = parts[1];
  if (!value || parts.length !== 2 || !isSettingKey(key)) {
    await ctx.reply("Usage: /settings wake|topic|report HH:mm\nExample: /settings wake 05:30");
    return;
  }
  const hhmm = parseHHmm(value);
  if (!hhmm) {
    await ctx.reply("Time must be HH:mm, from 00:00 to 23:59.");
    return;
  }
  const settings = await updateSetting(key, hhmm);
  await reloadScheduler();
  await ctx.reply(`Updated ${key} to ${hhmm} (${config.timezone}).\n\n${formatSettings(settings)}`);
}

async function handleTopics(ctx: Context, name: string, body: string): Promise<void> {
  if (name === "topics" && body === "") {
    await ctx.reply(await topicListText());
    return;
  }
  const text = topicAddText(name, body);
  if (text === null) {
    await ctx.reply("Usage: /topics\n/topics add <text>\n/topicadd <text>\nThe text can be several lines in one message.");
    return;
  }
  if (!text) {
    await ctx.reply("Topic text is empty.");
    return;
  }
  if (text.length > MAX_TOPIC_LENGTH) {
    await ctx.reply(`Topic is too long (max ${MAX_TOPIC_LENGTH} characters).`);
    return;
  }
  const id = await insertTopic(text);
  await ctx.reply(`Added topic #${id}.`);
}

async function topicListText(): Promise<string> {
  const topics = await listRecentTopics(10);
  if (topics.length === 0) {
    return "No topics yet.\nAdd one: /topics add your text\nOr: /topicadd your text";
  }
  const lines = topics.map((topic) => {
    const when = topic.last_used_on ?? "unused";
    return `#${topic.id} · ${when} · ${clip(topic.text)}`;
  });
  return ["Recent topics:", ...lines, "", "Add: /topics add <text> (one message, can be multi-line)", "Alias: /topicadd <text>"].join("\n");
}

function clip(text: string, max = 80): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

async function handleMembers(ctx: Context): Promise<void> {
  const stats = await getDailyStats(todayDateString(config.timezone));
  await ctx.reply(
    [
      "Members",
      `Started: ${stats.started}`,
      `Not started: ${stats.notStarted}`,
      `Woke up today: ${stats.wakes}`,
      `Topic replies today: ${stats.replies}`,
      "",
      "Counts use people who have pressed /start. The bot cannot list the whole group.",
    ].join("\n"),
  );
}
