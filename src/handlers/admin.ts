import type { Bot, Context } from "grammy";
import { standingBoardText, todayBoardText } from "../boards.js";
import { adminButtons, adminButtonAction, adminKeyboard, ensureAdminMenu, ensureMemberMenu, memberKeyboard } from "../admin-ui.js";
import { topicAddText } from "../commands.js";
import { config, isConfiguredAdmin } from "../config.js";
import { groupMemberCount, lookupGroup } from "../group.js";
import { feedbackBoardText } from "./feedback.js";
import { profileLink } from "../html.js";
import { formatSettings, postReport, reloadScheduler, type ReportPost } from "../jobs.js";
import {
  clearUserPending,
  findUser,
  getGroupChatId,
  getSettings,
  insertTopic,
  listRecentTopics,
  listStartedWakeTimes,
  setGroupChatId,
  settingColumns,
  updateSetting,
  type SettingKey,
} from "../repo.js";
import { errorText } from "../log.js";
import { deliveryProblemCounts } from "../store.js";
import { clipText, MAX_TOPIC_LENGTH, texts } from "../texts.js";
import { formatTime, parseHHmm, todayDateString } from "../time.js";

function isSettingKey(value: string): value is SettingKey {
  return value === "wake" || value === "topic" || value === "report" || value === "ontime" || value === "explain" || value === "plan" || value === "response";
}

function isAdmin(telegramId: number): boolean {
  return isConfiguredAdmin(telegramId);
}

export async function openAdminHome(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from || ctx.chat?.type !== "private") {
    await ctx.reply("Admin menyusi shaxsiy chatda ochiladi.");
    return;
  }
  if (!isAdmin(from.id)) {
    await ctx.reply("Bu buyruq adminlar uchun.", { reply_markup: memberKeyboard });
    return;
  }
  await ensureAdminMenu(ctx.api, from.id);
  await ctx.reply(texts.adminWelcome, { reply_markup: adminKeyboard });
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
  if (!isAdmin(from.id)) {
    await ctx.reply("🔒 This command is for admins. Ask an admin to add your Telegram ID in the bot settings.");
    return;
  }
  if (chatType !== "private" && name !== "group" && name !== "bindtopic") {
    await ctx.reply(`🔒 Open @${config.botUsername} privately to use admin commands. Send /start there to see the menu.`);
    return;
  }
  if (chatType === "private") {
    await ensureAdminMenu(ctx.api, from.id);
    pinAdminKeyboard(ctx);
  }

  switch (name) {
    case "settings":
      await handleSettings(ctx, body);
      return;
    case "topics":
    case "topicadd":
      await handleTopics(ctx, name, body);
      return;
    case "report":
      await replyReportPosted(ctx, bot);
      return;
    case "members": {
      const { usersText } = await import("./flow.js");
      const view = await usersText(0);
      await ctx.reply(view.text, { reply_markup: view.keyboard });
      return;
    }
    case "group":
      await handleGroup(ctx, bot, body);
      return;
    case "bindtopic":
      await handleBindTopic(ctx, body);
      return;
    default:
      return;
  }
}

export async function handleAdminButton(ctx: Context, bot: Bot): Promise<boolean> {
  if (ctx.chat?.type !== "private") return false;
  const text = ctx.message?.text;
  const from = ctx.from;
  const action = text && from ? adminButtonAction(text) : null;
  if (!action || !from) return false;
  if (!isAdmin(from.id)) return false;
  await clearUserPending(String(from.id));
  await ensureAdminMenu(ctx.api, from.id);
  pinAdminKeyboard(ctx);

  switch (action) {
    case adminButtons.woke:
      await ctx.reply(await wakeBoardText(), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
      return true;
    case adminButtons.topics:
      await handleTopics(ctx, "topics", "");
      return true;
    case adminButtons.settings:
      await handleSettings(ctx, "");
      return true;
    case adminButtons.standing:
      await ctx.reply(await standingBoardText(await getSettings(), await groupMemberCount(bot)), {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
      return true;
    case adminButtons.today:
      await ctx.reply(await todayBoardText(await getSettings(), await groupMemberCount(bot)), {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
      return true;
    case adminButtons.feedback:
      await ctx.reply(await feedbackBoardText(), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
      return true;
    case adminButtons.users: {
      const { usersText } = await import("./flow.js");
      const view = await usersText(0);
      await ctx.reply(view.text, { reply_markup: view.keyboard });
      return true;
    }
    case adminButtons.member:
      await ensureMemberMenu(ctx.api, from.id);
      await ctx.reply("Ishtirokchi oynasi.", { reply_markup: memberKeyboard });
      return true;
    case adminButtons.accountability: {
      const { handleFlowCallback } = await import("./flow.js");
      await handleFlowCallback({ ...ctx, callbackQuery: { data: "ac:0" }, from: ctx.from } as Context, bot);
      return true;
    }
    default:
      return false;
  }
}

function pinAdminKeyboard(ctx: Context): void {
  const reply = ctx.reply.bind(ctx);
  ctx.reply = (async (text, other) => {
    const extra = other && typeof other === "object" ? { ...other } : {};
    if (!("reply_markup" in extra)) extra.reply_markup = adminKeyboard;
    return reply(text, extra);
  }) as Context["reply"];
}

async function replyReportPosted(ctx: Context, bot: Bot): Promise<void> {
  const result = await postReport(bot);
  await ctx.reply(await reportReply(result));
}

async function reportReply(result: ReportPost): Promise<string> {
  if (result === "posted") return "✅ Today's report was posted to the group.";
  const chatId = await getGroupChatId();
  if (!chatId) return groupMissingText();
  return [
    "⚠️ Could not post the report.",
    `Saved group ID: ${chatId}`,
    "Check that the bot is in the group and can post. Then send /group inside that group.",
  ].join("\n");
}

function personLine(
  row: { telegramId: string; name: string; username: string | null; wakeUpAt: Date | null; wakeCard: string | null },
  onTime: string,
): string {
  const who = profileLink(row.telegramId, row.name, row.username);
  if (!row.wakeUpAt) return who;
  const time = formatTime(config.timezone, row.wakeUpAt);
  const mark = row.wakeCard === "red" ? "🔴" : row.wakeCard === "orange" ? "🟠" : row.wakeCard === "yellow" ? "🟡" : row.wakeCard === "green" ? "🟢" : time > onTime ? "🕒" : "✅";
  return `${mark} ${time}  ${who}`;
}

async function wakeBoardText(): Promise<string> {
  const rows = await listStartedWakeTimes(todayDateString(config.timezone));
  const onTime = (await getSettings()).on_time;
  if (rows.length === 0) {
    return "🌅 No one has pressed Start yet. Ask members to open the bot once so it can track their check-ins.";
  }
  const woke = rows.filter((row) => row.wakeUpAt);
  const asleep = rows.filter((row) => !row.wakeUpAt);
  const wokeLines = woke.slice(0, 40).map((row) => personLine(row, onTime));
  const lines = [`🌅 Checked in today: ${woke.length}/${rows.length}`, ...(wokeLines.length > 0 ? wokeLines : ["No check-ins yet. The morning button closes at 12:00."])];
  if (woke.length > wokeLines.length) lines.push(`… and ${woke.length - wokeLines.length} more`);
  if (asleep.length === 0) return lines.join("\n");
  const asleepLines = asleep.slice(0, 40).map((row) => personLine(row, onTime));
  lines.push("", "────────", "", `🌙 No check-in: ${asleep.length}`, ...asleepLines);
  if (asleep.length > asleepLines.length) lines.push(`… and ${asleep.length - asleepLines.length} more`);
  return lines.join("\n");
}

async function handleSettings(ctx: Context, body: string): Promise<void> {
  if (!body) {
    const problems = await deliveryProblemCounts();
    await ctx.reply(`${formatSettings(await getSettings(), await getGroupChatId())}\nDelivery problems: ${problems.failed} failed, ${problems.uncertain} uncertain.`);
    return;
  }
  if (body === "topics on" || body === "topics off") {
    const { setTopicScheduleEnabled } = await import("../repo.js");
    const settings = await setTopicScheduleEnabled(body.endsWith("on"));
    await reloadScheduler();
    await ctx.reply(formatSettings(settings, await getGroupChatId()));
    return;
  }
  if (body.startsWith("grace ")) {
    const minutes = Number(body.slice(6));
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 180) {
      await ctx.reply("Grace must be a whole number of minutes from 15 to 180.");
      return;
    }
    const { setGraceMinutes } = await import("../repo.js");
    const settings = await setGraceMinutes(minutes);
    await reloadScheduler();
    await ctx.reply(formatSettings(settings, await getGroupChatId()));
    return;
  }
  const parts = body.split(/\s+/);
  const key = parts[0]?.toLowerCase() ?? "";
  const value = parts[1];
  if (!value || parts.length !== 2 || !isSettingKey(key)) {
    await ctx.reply(
      "⏰ Usage: /settings wake|ontime|topic|explain|report HH:mm\nExamples: /settings wake 05:30\n/settings ontime 06:00\nThe wake time must be before 12:00.",
    );
    return;
  }
  const hhmm = parseHHmm(value);
  if (!hhmm) {
    await ctx.reply("⚠️ Use a valid time in HH:mm format, from 00:00 to 23:59. Example: 05:30.");
    return;
  }
  const next = { ...(await getSettings()), [settingColumns[key]]: hhmm };
  if (next.wake_time >= "12:00" || next.on_time > "12:00") {
    await ctx.reply("🌅 The morning button must post before 12:00, and the on-time deadline cannot be after 12:00.");
    return;
  }
  if (next.wake_time >= next.on_time) {
    await ctx.reply("⏰ The morning button must post before the on-time deadline. Change wake or ontime first.");
    return;
  }
  if (next.explain_time <= next.on_time) {
    await ctx.reply("📝 The request for reasons must run after the on-time deadline. Change explain or ontime first.");
    return;
  }
  if (next.report_time <= next.topic_time) {
    await ctx.reply("📊 The group report must run after the topic is sent. Change report or topic first.");
    return;
  }
  const settings = await updateSetting(key, hhmm);
  await reloadScheduler();
  await ctx.reply(
    `✅ Updated ${key} to ${hhmm}.\n\n${formatSettings(settings, await getGroupChatId())}`,
  );
}

function groupMissingText(): string {
  return [
    "👥 No group is connected yet.",
    "1. Add the bot to the group and make it an admin.",
    "2. Send /group inside that group. This is the easiest way.",
    "You can also send its numeric ID here:",
    "/group -1001234567890",
  ].join("\n");
}

async function handleGroup(ctx: Context, bot: Bot, body: string): Promise<void> {
  const typed = body.trim();
  if (!typed) {
    const chatType = ctx.chat?.type;
    if ((chatType === "group" || chatType === "supergroup") && ctx.chat) {
      await bindGroup(ctx, bot, String(ctx.chat.id));
      return;
    }
    const current = await getGroupChatId();
    await ctx.reply(
      current ? `👥 Connected group ID: ${current}\nTo switch groups, send /group inside the new group.` : groupMissingText(),
    );
    return;
  }
  if (!/^-?\d+$/.test(typed)) {
    await ctx.reply("⚠️ The group ID must be a number, like -1001234567890. You can also send /group inside the group.");
    return;
  }
  await bindGroup(ctx, bot, typed);
}

async function bindGroup(ctx: Context, bot: Bot, chatId: string): Promise<void> {
  const found = await lookupGroup(bot, chatId);
  if (!found.ok) {
    await ctx.reply(
      found.reason === "notgroup"
        ? "⚠️ That ID is not a group. Send /group inside the group to connect it."
        : "⚠️ I could not access that group. Add me as an admin there, then send /group inside it.",
    );
    return;
  }
  try {
    const me = await bot.api.getMe();
    const member = await bot.api.getChatMember(found.id, me.id);
    if (member.status !== "administrator" && member.status !== "creator") {
      await ctx.reply("⚠️ I am in that group but need admin rights to post. Promote me, then send /group again.");
      return;
    }
  } catch (err) {
    const detail = errorText(err);
    if (/chat not found|kicked|not a member|not enough rights|have no rights|forbidden/i.test(detail)) {
      await ctx.reply("⚠️ I could not access that group. Add me as an admin, then send /group inside it.");
      return;
    }
    throw err;
  }
  await setGroupChatId(found.id);
  await ctx.reply(`✅ Connected to ${found.title} (${found.id}). Morning posts, replies, and reports will go there.`);
}

async function handleTopics(ctx: Context, name: string, body: string): Promise<void> {
  if (name === "topics" && body === "") {
    const { topicBrowserText } = await import("./flow.js");
    const view = await topicBrowserText(0);
    await ctx.reply(view.text, { reply_markup: view.keyboard });
    return;
  }
  const text = topicAddText(name, body);
  if (text === null) {
    await ctx.reply("🧠 Send /topics to see the latest topics.\nAdd one with /topics add your question\nThe question can span several lines.");
    return;
  }
  if (!text) {
    await ctx.reply("⚠️ The topic is empty. Add a question after /topics add.");
    return;
  }
  if (text.length > MAX_TOPIC_LENGTH) {
    await ctx.reply(`✂️ This topic is too long. Limit: ${MAX_TOPIC_LENGTH} characters.`);
    return;
  }
  const id = await insertTopic(text);
  await ctx.reply(`✅ Topic #${id} was added to the rotation.`);
}

async function handleBindTopic(ctx: Context, body: string): Promise<void> {
  const slot = body.trim().toLowerCase();
  if (slot !== "daily" && slot !== "unusual" && slot !== "reminders" && slot !== "exercises") {
    await ctx.reply("Usage: /bindtopic daily|unusual|reminders|exercises — send it inside the forum topic.");
    return;
  }
  const threadId = ctx.message?.message_thread_id;
  const chatType = ctx.chat?.type;
  if ((chatType !== "supergroup" && chatType !== "group") || threadId == null || !ctx.chat) {
    await ctx.reply("Open the forum topic and send /bindtopic there.");
    return;
  }
  const { bindTopic, getGroupChatId } = await import("../repo.js");
  const saved = await getGroupChatId();
  if (saved !== String(ctx.chat.id)) {
    await ctx.reply("Connect this forum with /group before binding topics.");
    return;
  }
  await bindTopic(slot, threadId);
  await ctx.reply(`Saved ${slot} topic ${threadId}.`);
}

async function topicListText(): Promise<string> {
  const topics = await listRecentTopics(10);
  if (topics.length === 0) {
    return "🧠 No topics yet. Add one with /topics add your question. Members receive one shared topic each day.";
  }
  const lines = topics.map((topic) => {
    const when = topic.last_used_on ?? "not used yet";
    return `#${topic.id} · ${when} · ${clipText(topic.text, 80)}`;
  });
  return ["🧠 Recent topics:", ...lines, "", "➕ Add: /topics add your question (one message, multiple lines allowed)"].join("\n");
}
