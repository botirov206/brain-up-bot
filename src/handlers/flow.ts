import { InlineKeyboard, type Bot, type Context } from "grammy";
import { expirePending, requireParticipantAccess, type Access } from "../access.js";
import { memberKeyboard } from "../admin-ui.js";
import { dispatchDailyTopics, flushDeliveries, forumDestination } from "../challenge.js";
import { config, isConfiguredAdmin } from "../config.js";
import { query } from "../db.js";
import { checkForumMembership, isForumAdminStatus } from "../membership.js";
import { navigationLabels } from "../pages.js";
import { findUser, getGroupChatId, setUserPending } from "../repo.js";
import {
  activeWaitlistUserIds,
  clearBlocked,
  confirmAnnouncement,
  countActionableCases,
  countActiveWaitlist,
  countKnownMembers,
  createAnnouncementDraft,
  createDraftPlan,
  enqueueDelivery,
  replacePlanTasks,
  getAnnouncement,
  getCase,
  getPlan,
  getTopic,
  joinWaitlist,
  listActionableCases,
  listKnownMembers,
  listWaitlist,
  publishPlan,
  rememberPlanMessage,
  saveJudgment,
  setBlocked,
  setPlanNote,
  setTaskCompletion,
  topicPage,
  withdrawWaitlist,
} from "../store.js";
import { clipText, texts } from "../texts.js";
import { formatTaskLine, parseTodoList } from "../todo-parse.js";
import { shiftDate, todayDateString, zonedTimeToUtc } from "../time.js";

export async function replyDenied(ctx: Context, access: Access): Promise<void> {
  if (access.ok) return;
  const member = ctx.chat?.type === "private" ? { reply_markup: memberKeyboard } : {};
  if (access.code === "blocked") {
    await ctx.reply(texts.blocked, member);
    return;
  }
  if (access.code !== "non_member") {
    if (access.code === "unavailable" && !access.chatId) {
      await ctx.reply(texts.forumNotConnected, member);
      return;
    }
    await ctx.reply(texts.membershipUnavailable, member);
    return;
  }
  const keyboard = new InlineKeyboard().text(texts.joinButton, "wj").text(texts.recheckButton, "wr");
  await ctx.reply(texts.waitlistOffer, { reply_markup: keyboard });
}

export async function handleFlowCallback(ctx: Context, bot: Bot): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const from = ctx.from;
  if (!from || from.is_bot) return;
  if (data === "wj" || data === "wr" || data === "ww") {
    await waitlistCallback(ctx, bot, data);
    return;
  }
  if (data.startsWith("tp:") || data.startsWith("tv:") || data.startsWith("tb:") || data === "ts") {
    if (!isConfiguredAdmin(from.id)) return;
    await topicCallback(ctx, bot, data);
    return;
  }
  if (data.startsWith("us:") || data.startsWith("ud:") || data.startsWith("ur:") || data.startsWith("ux:") || data.startsWith("uo:") || data.startsWith("wl:") || data === "wa") {
    if (!isConfiguredAdmin(from.id)) return;
    await usersCallback(ctx, bot, data);
    return;
  }
  if (data.startsWith("pc:") || data.startsWith("pp:") || data.startsWith("pb:") || data === "pn" || data === "py" || data === "pz" || data === "pe") {
    await planCallback(ctx, bot, data);
    return;
  }
  if (data.startsWith("jp:")) {
    if (!isConfiguredAdmin(from.id)) return;
    await publishPreview(ctx, bot, Number(data.slice(3)));
    return;
  }
  if (data.startsWith("wc:") || data.startsWith("ws:") || data.startsWith("wx:")) {
    if (!isConfiguredAdmin(from.id)) return;
    const { reviewLateReason } = await import("./explain.js");
    const parts = data.split(":");
    const raw = data.startsWith("ws:") ? "yellow" : data.startsWith("wx:") ? "late" : parts[3];
    if (raw !== "yellow" && raw !== "orange" && raw !== "red" && raw !== "late") return;
    await reviewLateReason(ctx, bot, Number(parts[1]), parts[2] ?? "", raw);
    return;
  }
  if (data.startsWith("ac:") || data.startsWith("ao:") || data.startsWith("ae:") || data.startsWith("ax:") || data.startsWith("wy:")) {
    if (!isConfiguredAdmin(from.id)) return;
    await adminCaseCallback(ctx, bot, data);
  }
}

async function waitlistCallback(ctx: Context, bot: Bot, data: string): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  const chatId = await getGroupChatId();
  if (!chatId) {
    await ctx.reply(texts.membershipUnavailable);
    return;
  }
  if (data === "wr") {
    const access = await requireParticipantAccess({
      api: bot.api,
      telegramId: String(from.id),
      name: from.first_name,
      username: from.username ?? null,
      isBot: from.is_bot,
    });
    if (access.ok) {
      await ctx.reply("A’zolik tasdiqlandi. Endi bugungi reja va mavzudan foydalanishingiz mumkin.");
      return;
    }
    await replyDenied(ctx, access);
    return;
  }
  const user = await findUser(String(from.id));
  if (!user) {
    await ctx.reply(texts.replyNeedStart);
    return;
  }
  if (data === "wj") {
    const joined = await joinWaitlist(user.id, chatId);
    await ctx.reply(joined.created ? texts.waitlistJoined : texts.waitlistAlready);
    return;
  }
  const removed = await withdrawWaitlist(user.id);
  await ctx.reply(removed ? texts.waitlistLeft : texts.waitlistAlready);
}

export async function topicBrowserText(page: number): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const size = 5;
  const window = await topicPage(size, Math.max(0, page) * size);
  const pages = Math.max(1, Math.ceil(window.total / size));
  const safe = Math.min(Math.max(page, 0), pages - 1);
  const lines = [`Topics ${window.total} · page ${safe + 1}/${pages}`];
  const keyboard = new InlineKeyboard();
  if (window.rows.length === 0) lines.push("No topics yet. Add one with /topics add.");
  for (const topic of window.rows) {
    lines.push(`#${topic.id} · ${clipText(topic.text, 400)}`);
  }
  for (const topic of window.rows) {
    keyboard.text(`#${topic.id}`, `tv:${topic.id}`);
  }
  if (window.rows.length > 0) keyboard.row();
  const nav = navigationLabels(safe, pages);
  if (nav.prev) keyboard.text("⬅️", `tp:${safe - 1}`);
  if (nav.next) keyboard.text("➡️", `tp:${safe + 1}`);
  keyboard.row().text("Send today’s topics", "ts");
  return { text: lines.join("\n\n"), keyboard };
}

async function topicCallback(ctx: Context, bot: Bot, data: string): Promise<void> {
  if (data === "ts") {
    const chatId = await getGroupChatId();
    if (!chatId) {
      await ctx.reply("Connect the forum with /group first.");
      return;
    }
    await dispatchDailyTopics(bot, chatId, todayDateString(config.timezone));
    await ctx.reply("Today’s assignments were saved and queued.");
    return;
  }
  if (data.startsWith("tv:")) {
    const topic = await getTopic(Number(data.slice(3)));
    const keyboard = new InlineKeyboard().text("Back", "tb:0");
    await editOrReply(ctx, topic ? `#${topic.id}\n\n${topic.text}` : "That topic no longer exists.", keyboard);
    return;
  }
  const page = Number(data.slice(3));
  const view = await topicBrowserText(Number.isInteger(page) ? page : 0);
  await editOrReply(ctx, view.text, view.keyboard);
}

export async function usersText(page: number): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const chatId = await getGroupChatId();
  const keyboard = new InlineKeyboard();
  if (!chatId) return { text: "Connect the forum with /group before opening Users.", keyboard };
  const total = await countKnownMembers(chatId);
  const waiting = await countActiveWaitlist(chatId);
  const size = 10;
  const pages = Math.max(1, Math.ceil(total / size) || 1);
  const safe = Math.min(Math.max(page, 0), pages - 1);
  const rows = await listKnownMembers(chatId, size, safe * size);
  const lines = [
    `Users ${total} · page ${safe + 1}/${pages}`,
    "Telegram does not give bots the full member roster. This list is people verified after Start, a forum message, or a membership update.",
  ];
  for (const row of rows) {
    const privateReady = row.startedAt && row.privateReachable !== false ? "DM on" : "DM off";
    const access = row.blockedAt ? "blocked" : row.isMember ? "participant" : "not participating";
    lines.push(`${row.name} · ${privateReady} · ${access}`);
    keyboard.text(row.name.slice(0, 30), `ud:${row.id}`).row();
  }
  if (rows.length === 0) lines.push("No verified members yet.");
  const nav = navigationLabels(safe, pages);
  if (nav.prev) keyboard.text("⬅️", `us:${safe - 1}`);
  if (nav.next) keyboard.text("➡️", `us:${safe + 1}`);
  keyboard.row().text(`Waitlist (${waiting})`, "wl:0");
  return { text: lines.join("\n"), keyboard };
}

async function usersCallback(ctx: Context, bot: Bot, data: string): Promise<void> {
  if (data === "wa") {
    await beginAnnouncement(ctx);
    return;
  }
  if (data.startsWith("wl:")) {
    const [text, keyboard] = await waitlistView(Number(data.slice(3)) || 0);
    await editOrReply(ctx, text, keyboard);
    return;
  }
  if (data.startsWith("us:")) {
    const view = await usersText(Number(data.slice(3)) || 0);
    await editOrReply(ctx, view.text, view.keyboard);
    return;
  }
  const id = Number(data.split(":")[1]);
  if (!Number.isInteger(id)) return;
  if (data.startsWith("ud:")) {
    const [text, keyboard] = await memberDetail(id);
    await editOrReply(ctx, text, keyboard);
    return;
  }
  if (data.startsWith("ur:")) {
    const keyboard = new InlineKeyboard().text("Confirm removal", `ux:${id}`).row().text("Back", `ud:${id}`);
    await editOrReply(ctx, "Remove this person from the challenge and ban them in the forum. A supergroup ban can also remove that person’s message history. Past activity stays in the database.", keyboard);
    return;
  }
  if (data.startsWith("ux:")) {
    await executeRemoval(ctx, bot, id);
    return;
  }
  if (data.startsWith("uo:")) await executeRestore(ctx, bot, id);
}

async function memberDetail(userId: number): Promise<[string, InlineKeyboard]> {
  const result = await query<{ id: number; name: string; username: string | null; started_at: Date | null; blocked_at: Date | null }>(
    `SELECT id, name, username, started_at, blocked_at FROM users WHERE id = $1`,
    [userId],
  );
  const user = result.rows[0];
  const keyboard = new InlineKeyboard().text("Back", "us:0");
  if (!user) return ["User not found.", keyboard];
  keyboard.text(user.blocked_at ? "Restore access" : "Remove user", user.blocked_at ? `uo:${user.id}` : `ur:${user.id}`);
  return [
    [user.name, user.username ? `@${user.username}` : "no username", user.started_at ? "Private chat: on" : "Private chat: off", user.blocked_at ? "Access: blocked" : "Access: open"].join("\n"),
    keyboard,
  ];
}

async function executeRemoval(ctx: Context, bot: Bot, userId: number): Promise<void> {
  const from = ctx.from;
  const chatId = await getGroupChatId();
  if (!from || !isConfiguredAdmin(from.id) || !chatId) return;
  const target = await query<{ telegram_id: string; name: string }>(
    `SELECT telegram_id::text AS telegram_id, name FROM users WHERE id = $1`,
    [userId],
  );
  const row = target.rows[0];
  if (!row) return;
  const me = await bot.api.getMe();
  if (row.telegram_id === String(me.id) || isConfiguredAdmin(row.telegram_id)) {
    await ctx.reply("That person cannot be removed.");
    return;
  }
  const member = await checkForumMembership(bot.api, chatId, row.telegram_id);
  if (member.kind === "member" && isForumAdminStatus(member.telegramStatus)) {
    await ctx.reply("Forum administrators and the owner cannot be removed here.");
    return;
  }
  await setBlocked(userId, String(from.id), "removed by admin");
  try {
    await bot.api.banChatMember(chatId, Number(row.telegram_id));
    await ctx.reply(`${row.name} is blocked in the bot and banned from the forum. Their past activity is still in the database.`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const keyboard = new InlineKeyboard().text("Retry ban", `ux:${userId}`);
    await ctx.reply(`Challenge access is off, but the forum ban failed: ${detail}`, { reply_markup: keyboard });
  }
}

async function executeRestore(ctx: Context, bot: Bot, userId: number): Promise<void> {
  const from = ctx.from;
  const chatId = await getGroupChatId();
  if (!from || !isConfiguredAdmin(from.id) || !chatId) return;
  const target = await query<{ telegram_id: string }>(`SELECT telegram_id::text AS telegram_id FROM users WHERE id = $1`, [userId]);
  const telegramId = target.rows[0]?.telegram_id;
  if (!telegramId) return;
  await clearBlocked(userId);
  try {
    await bot.api.unbanChatMember(chatId, Number(telegramId), { only_if_banned: true });
  } catch {
    await ctx.reply("The bot block is cleared. Telegram did not confirm the unban.");
    return;
  }
  const check = await checkForumMembership(bot.api, chatId, telegramId);
  await ctx.reply(check.kind === "member" ? "Access restored and forum membership is valid." : "Access restored. They are not in the forum until they join again.");
}

async function waitlistView(page: number): Promise<[string, InlineKeyboard]> {
  const chatId = await getGroupChatId();
  const keyboard = new InlineKeyboard().text("Back", "us:0");
  if (!chatId) return ["No forum is connected.", keyboard];
  const total = await countActiveWaitlist(chatId);
  const rows = await listWaitlist(chatId, 10, page * 10);
  const lines = [`Waitlist (${total})`];
  for (const row of rows) {
    lines.push(`${row.name}${row.username ? ` @${row.username}` : ""} · ${row.joinedAt.toISOString().slice(0, 10)}`);
  }
  if (rows.length === 0) lines.push("Nobody is waiting.");
  keyboard.row().text("Write announcement", "wa");
  const pages = Math.max(1, Math.ceil(total / 10));
  const nav = navigationLabels(page, pages);
  if (nav.prev) keyboard.text("⬅️", `wl:${page - 1}`);
  if (nav.next) keyboard.text("➡️", `wl:${page + 1}`);
  return [lines.join("\n"), keyboard];
}

async function planCallback(ctx: Context, bot: Bot, data: string): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  const access = await requireParticipantAccess({
    api: bot.api,
    telegramId: String(from.id),
    name: from.first_name,
    username: from.username ?? null,
  });
  if (!access.ok) {
    await replyDenied(ctx, access);
    return;
  }
  const date = todayDateString(config.timezone);
  if (data === "pn") {
    await setUserPending(access.user.id, "todo", { date, mode: "create" }, endOfDay(date));
    await ctx.reply("Bugungi vazifalarni yuboring. Har birini alohida qatorga yozing.");
    return;
  }
  if (data === "py") {
    await copyYesterday(ctx, access.user.id, access.chatId, date);
    return;
  }
  if (data === "pz") {
    await setUserPending(access.user.id, "note", { date }, endOfDay(date));
    await ctx.reply("Bugun qanday o‘tganini qisqacha yozing.");
    return;
  }
  if (data === "pe") {
    await setUserPending(access.user.id, "todo", { date, mode: "edit" }, endOfDay(date));
    await ctx.reply("Yangilangan ro‘yxatni yuboring. Faqat soat yozilgan qatorlar olinadi, masalan 09:00 | Kitob.");
    return;
  }
  if (data.startsWith("pp:")) {
    await showPlan(ctx, access.user.id, date, true);
    return;
  }
  if (data.startsWith("pb:")) {
    const parts = data.split(":");
    const published = await publishPlan(Number(parts[1]), access.user.id, Number(parts[2]));
    if (!published) {
      await ctx.reply("Reja yangilangan. «Bugungi rejam»ni qayta oching.");
      return;
    }
    await publishPlanMessages(ctx, bot, access.user.id, date);
    await ctx.reply("Reja guruhga chiqdi.");
    return;
  }
  if (data.startsWith("pc:")) {
    const parts = data.split(":");
    const result = await setTaskCompletion(Number(parts[1]), access.user.id, parts[3] === "1", Number(parts[2]), date);
    if (result === "forbidden") return;
    await schedulePlanEdits(access.user.id, date, access.user.name);
    await flushDeliveries(bot, 4);
    await showPlan(ctx, access.user.id, date, true);
  }
}

export async function openPlan(ctx: Context, bot: Bot): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  const access = await requireParticipantAccess({
    api: bot.api,
    telegramId: String(from.id),
    name: from.first_name,
    username: from.username ?? null,
  });
  if (!access.ok) {
    await replyDenied(ctx, access);
    return;
  }
  await showPlan(ctx, access.user.id, todayDateString(config.timezone), false);
}

async function showPlan(ctx: Context, userId: number, date: string, edit: boolean): Promise<void> {
  const plan = await getPlan(userId, date);
  const user = await findUser(String(ctx.from?.id ?? ""));
  if (!plan) {
    const keyboard = new InlineKeyboard().text("➕ Yangi ro‘yxat", "pn").text("↩️ Kechadan nusxa", "py");
    await ctx.reply("Bugungi reja hali yo‘q. Yangi ro‘yxat yozing yoki kechagisidan nusxa oling.", { reply_markup: keyboard });
    return;
  }
  const done = plan.tasks.filter((task) => task.completed).length;
  const lines = [`📋 ${user?.name ?? "Ishtirokchi"} — ${displayDate(date)}`, `Bajarildi: ${done}/${plan.tasks.length}`, ""];
  const keyboard = new InlineKeyboard();
  for (const task of plan.tasks) lines.push(formatTaskLine(task, task.completed));
  if (plan.state === "published") addTickButtons(keyboard, plan.tasks, plan.revision);
  if (plan.note) lines.push("", `📝 ${plan.note}`);
  if (plan.state === "draft") keyboard.text("📣 E’lon qilish", `pb:${plan.id}:${plan.revision}`);
  if (plan.state === "published" && date === todayDateString(config.timezone)) {
    keyboard.row().text("✏️ Tahrirlash", "pe").text("📝 Kun haqida", "pz");
  }
  if (edit) await editOrReply(ctx, lines.join("\n"), keyboard);
  else await ctx.reply(lines.join("\n"), { reply_markup: keyboard });
}

export async function captureTodo(ctx: Context, bot: Bot): Promise<boolean> {
  if (ctx.chat?.type !== "private") return false;
  const from = ctx.from;
  const text = ctx.message?.text?.trim();
  if (!from || !text) return false;
  const found = await findUser(String(from.id));
  if (!found) return false;
  const user = await expirePending(found);
  if (user.pending !== "todo" && user.pending !== "note") return false;
  const access = await requireParticipantAccess({
    api: bot.api,
    telegramId: String(from.id),
    name: from.first_name,
    username: from.username ?? null,
  });
  if (!access.ok) {
    await replyDenied(ctx, access);
    return true;
  }
  const date = todayDateString(config.timezone);
  const mode = (user.pending_payload as { mode?: string } | null)?.mode;
  if (user.pending === "note") {
    const plan = await getPlan(access.user.id, date);
    if (!plan || plan.state !== "published") {
      await ctx.reply("Avval bugungi rejani guruhga chiqaring.");
      return true;
    }
    const saved = await setPlanNote(plan.id, access.user.id, text.slice(0, 1000));
    await setUserPending(access.user.id, null);
    await ctx.reply(saved ? "Saqlandi." : "Saqlab bo‘lmadi. Yana bir bor yuboring.");
    return true;
  }
  const parsed = parseTodoList(text);
  if (!parsed.ok) {
    await ctx.reply(parsed.error);
    return true;
  }
  if (mode === "edit") {
    const saved = await replacePlanTasks(access.user.id, access.chatId, date, parsed.original, parsed.tasks);
    await setUserPending(access.user.id, null);
    if (saved.state === "published") {
      await schedulePlanEdits(access.user.id, date, access.user.name);
      await flushDeliveries(bot, 4);
      await showPlan(ctx, access.user.id, date, false);
      return true;
    }
    const edited = await getPlan(access.user.id, date);
    const keyboard = new InlineKeyboard().text("📣 E’lon qilish", `pb:${saved.planId}:${edited?.revision ?? saved.revision}`);
    await ctx.reply(`Mana rejangiz. To‘g‘ri bo‘lsa, «E’lon qilish»ni bosing.\n\n${parsed.tasks.map((task) => formatTaskLine(task, false)).join("\n")}`, { reply_markup: keyboard });
    return true;
  }
  const planId = await createDraftPlan(access.user.id, access.chatId, date, parsed.original, parsed.tasks);
  await setUserPending(access.user.id, null);
  const plan = await getPlan(access.user.id, date);
  const keyboard = new InlineKeyboard().text("📣 E’lon qilish", `pb:${planId}:${plan?.revision ?? 1}`);
  await ctx.reply(`Mana rejangiz. To‘g‘ri bo‘lsa, «E’lon qilish»ni bosing.\n\n${parsed.tasks.map((task) => formatTaskLine(task, false)).join("\n")}`, { reply_markup: keyboard });
  return true;
}

async function copyYesterday(ctx: Context, userId: number, chatId: string, date: string): Promise<void> {
  const yesterday = await getPlan(userId, shiftDate(date, -1));
  if (!yesterday || yesterday.tasks.length === 0) {
    await ctx.reply("Kechagi reja topilmadi.");
    return;
  }
  const tasks = yesterday.tasks.map((task) => ({ title: task.title, start: task.start, end: task.end }));
  try {
    const planId = await createDraftPlan(userId, chatId, date, yesterday.original, tasks);
    const plan = await getPlan(userId, date);
    const keyboard = new InlineKeyboard().text("📣 E’lon qilish", `pb:${planId}:${plan?.revision ?? 1}`);
    await ctx.reply(`Kechagi vazifalar bugungi ro‘yxatga ko‘chirildi.\n\n${tasks.map((task) => formatTaskLine(task, false)).join("\n")}`, { reply_markup: keyboard });
  } catch {
    await ctx.reply("Bugungi reja allaqachon guruhda.");
  }
}

async function publishPlanMessages(ctx: Context, bot: Bot, userId: number, date: string): Promise<void> {
  const plan = await getPlan(userId, date);
  const user = await findUser(String(ctx.from?.id ?? ""));
  if (!plan || !user) return;
  const text = [`📋 ${user.name} — ${displayDate(date)}`, `Bajarildi: 0/${plan.tasks.length}`, "", ...plan.tasks.map((task) => formatTaskLine(task, false))].join("\n");
  const dest = await forumDestination("daily");
  if (!dest) {
    await ctx.reply("Reja saqlandi, lekin kunlik hisobot mavzusiga chiqarilmadi. Admin mavzuni ulashi kerak.");
    return;
  }
  await enqueueDelivery({
    logicalKey: `plan-forum:${plan.id}`,
    operation: "plan_forum",
    chatId: dest.chatId,
    topicId: dest.topicId,
    payload: { text, planId: plan.id, userId, date },
  });
  if (user.started_at) {
    await enqueueDelivery({
      logicalKey: `plan-private:${plan.id}`,
      operation: "plan_private",
      chatId: user.telegram_id,
      topicId: null,
      payload: { text, planId: plan.id, userId, date },
    });
  }
  await flushDeliveries(bot, 5);
}

async function adminCaseCallback(ctx: Context, bot: Bot, data: string): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  if (data.startsWith("wy:")) {
    const ok = await confirmAnnouncement(Number(data.slice(3)), String(from.id));
    await ctx.reply(ok ? "Announcement queued. Waiting people stay on the list." : "This announcement was already confirmed.");
    if (ok) await queueAnnouncement(bot, Number(data.slice(3)));
    return;
  }
  if (data.startsWith("ac:")) {
    const chatId = await getGroupChatId();
    const page = Number(data.slice(3)) || 0;
    const total = chatId ? await countActionableCases(chatId) : 0;
    const rows = chatId ? await listActionableCases(chatId, 10, page * 10) : [];
    const keyboard = new InlineKeyboard();
    const lines = [`Accountability ${total}`];
    for (const row of rows) {
      lines.push(`${row.name} · ${row.requirement}`);
      keyboard.text(`#${row.id} ${row.name}`.slice(0, 40), `ao:${row.id}`).row();
    }
    if (rows.length === 0) lines.push("No cases are past the grace period.");
    await editOrReply(ctx, lines.join("\n"), keyboard);
    return;
  }
  if (data.startsWith("ao:")) {
    const item = await getCase(Number(data.slice(3)));
    if (!item) return;
    const keyboard = new InlineKeyboard().text("Excuse", `ae:${item.id}`).text("Assign exercise", `ax:${item.id}`);
    await editOrReply(ctx, `${item.name}\n${item.requirement}\n${item.explanation ?? "No explanation"}`, keyboard);
    return;
  }
  const caseId = Number(data.slice(3));
  const kind = data.startsWith("ae:") ? "excuse" : "exercise";
  const user = await findUser(String(from.id));
  if (!user) return;
  await setUserPending(user.id, "judgment", { caseId, kind }, endOfDay(todayDateString(config.timezone)));
  await ctx.reply(kind === "excuse" ? "Write the excuse text." : "Write the exercise text.");
}

async function queueAnnouncement(bot: Bot, announcementId: number): Promise<void> {
  const saved = await getAnnouncement(announcementId);
  if (!saved) return;
  const { announcementAudience, markAnnouncementDelivery } = await import("../store.js");
  const audience = await announcementAudience(announcementId);
  for (const person of audience) {
    try {
      await bot.api.sendMessage(person.telegramId, saved.body);
      await markAnnouncementDelivery(announcementId, person.userId, "sent", null);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await markAnnouncementDelivery(announcementId, person.userId, "failed", detail);
    }
  }
}

async function publishPreview(ctx: Context, bot: Bot, caseId: number): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  const user = await findUser(String(from.id));
  const payload = user?.pending_payload as { caseId?: number; kind?: "excuse" | "exercise"; body?: string } | null;
  if (!user || !payload?.body || payload.caseId !== caseId || !payload.kind) return;
  const dest = await forumDestination("exercises");
  if (!dest) {
    await ctx.reply("The exercises topic is not bound. The judgment was not published.");
    return;
  }
  const sent = await bot.api.sendMessage(dest.chatId, payload.body, { message_thread_id: dest.topicId });
  await saveJudgment({
    caseId,
    adminTelegramId: String(from.id),
    body: payload.body,
    kind: payload.kind,
    chatId: dest.chatId,
    topicId: dest.topicId,
    messageId: sent.message_id,
  });
  await setUserPending(user.id, null);
  await ctx.reply("Published in the exercises topic.");
}

export async function captureJudgment(ctx: Context, bot: Bot): Promise<boolean> {
  const from = ctx.from;
  const text = ctx.message?.text?.trim();
  if (!from || !text || !isConfiguredAdmin(from.id)) return false;
  const user = await findUser(String(from.id));
  if (!user || user.pending !== "judgment") return false;
  const payload = user.pending_payload as { caseId?: number; kind?: "excuse" | "exercise" } | null;
  if (!payload?.caseId || !payload.kind) return false;
  const keyboard = new InlineKeyboard().text("Publish", `jp:${payload.caseId}`);
  await setUserPending(user.id, "judgment", { ...payload, body: text, preview: true }, endOfDay(todayDateString(config.timezone)));
  await ctx.reply(`Preview:\n\n${text}`, { reply_markup: keyboard });
  return true;
}

export async function captureAnnouncement(ctx: Context): Promise<boolean> {
  const from = ctx.from;
  const text = ctx.message?.text?.trim();
  if (!from || !text || !isConfiguredAdmin(from.id)) return false;
  const user = await findUser(String(from.id));
  if (user?.pending !== "announcement") return false;
  const chatId = await getGroupChatId();
  if (!chatId) return true;
  const ids = await activeWaitlistUserIds(chatId);
  const announcementId = await createAnnouncementDraft(String(from.id), text, ids);
  await setUserPending(user.id, null);
  const saved = await getAnnouncement(announcementId);
  const keyboard = new InlineKeyboard().text("Send", `wy:${announcementId}`);
  await ctx.reply(`Send this to ${saved?.count ?? ids.length} people?\n\n${text}`, { reply_markup: keyboard });
  return true;
}

export async function showMyTopic(ctx: Context, bot: Bot): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  const access = await requireParticipantAccess({
    api: bot.api,
    telegramId: String(from.id),
    name: from.first_name,
    username: from.username ?? null,
  });
  if (!access.ok) {
    await replyDenied(ctx, access);
    return;
  }
  const date = todayDateString(config.timezone);
  const plan = await query<{ text: string }>(
    `SELECT t.text FROM days d JOIN topics t ON t.id = d.topic_id WHERE d.user_id = $1 AND d.date = $2::date`,
    [access.user.id, date],
  );
  await ctx.reply(plan.rows[0] ? texts.topicMine(plan.rows[0].text) : texts.topicMissing);
}

export async function beginAnnouncement(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from || !isConfiguredAdmin(from.id)) return;
  const user = await findUser(String(from.id));
  if (!user) return;
  await setUserPending(user.id, "announcement", {}, endOfDay(todayDateString(config.timezone)));
  await ctx.reply("Write the waitlist announcement. Nothing is sent until you confirm.");
}

async function editOrReply(ctx: Context, text: string, keyboard: InlineKeyboard): Promise<void> {
  try {
    await ctx.editMessageText(text, { reply_markup: keyboard });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (/message is not modified/i.test(detail)) return;
    await ctx.reply(text, { reply_markup: keyboard });
  }
}

async function schedulePlanEdits(userId: number, date: string, name: string): Promise<void> {
  const plan = await getPlan(userId, date);
  if (!plan || plan.state !== "published") return;
  const done = plan.tasks.filter((task) => task.completed).length;
  const text = [
    `📋 ${name || "Ishtirokchi"} — ${displayDate(date)}`,
    `Bajarildi: ${done}/${plan.tasks.length}`,
    "",
    ...plan.tasks.map((task) => formatTaskLine(task, task.completed)),
    ...(plan.note ? ["", `📝 ${plan.note}`] : []),
  ].join("\n");
  const markup = { inline_keyboard: tickKeyboard(plan.tasks, plan.revision).inline_keyboard };
  if (plan.forumMessageId && plan.forumChatId) {
    await enqueueDelivery({
      logicalKey: `plan-edit-forum:${plan.id}`,
      operation: "plan_edit",
      chatId: plan.forumChatId,
      topicId: plan.forumTopicId,
      coalesce: true,
      payload: { text, messageId: plan.forumMessageId, markup },
    });
  }
  if (plan.privateMessageId && plan.privateChatId) {
    await enqueueDelivery({
      logicalKey: `plan-edit-private:${plan.id}`,
      operation: "plan_edit",
      chatId: plan.privateChatId,
      topicId: null,
      coalesce: true,
      payload: { text, messageId: plan.privateMessageId, markup },
    });
  }
}

export async function handleForumTodo(ctx: Context, bot: Bot, body: string, explicit = false): Promise<boolean> {
  const from = ctx.from;
  if (!from || from.is_bot || ctx.message?.sender_chat) return false;
  const dest = await forumDestination("daily");
  if (!dest || String(ctx.chat?.id) !== dest.chatId || ctx.message?.message_thread_id !== dest.topicId) return false;
  if (!explicit && !looksLikePlan(body)) return false;
  const access = await requireParticipantAccess({
    api: bot.api,
    telegramId: String(from.id),
    name: from.first_name,
    username: from.username ?? null,
  });
  if (!access.ok) {
    await replyDenied(ctx, access);
    return true;
  }
  const parsed = parseTodoList(body);
  if (!parsed.ok) {
    await ctx.reply(parsed.error);
    return true;
  }
  const date = todayDateString(config.timezone);
  const saved = await replacePlanTasks(access.user.id, dest.chatId, date, parsed.original, parsed.tasks);
  if (saved.state === "draft") {
    const published = await publishPlan(saved.planId, access.user.id, saved.revision);
    if (!published) {
      await ctx.reply("Reja yangilangan. «Bugungi rejam»ni qayta oching.");
      return true;
    }
  }
  const plan = await getPlan(access.user.id, date);
  if (!plan) return true;
  await deliverPlanCopies(bot, plan, access.user, date);
  return true;
}

function looksLikePlan(text: string): boolean {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2) return true;
  return /^(?:[-*•]|\d+[.)]|[☐✅]|\d{1,2}:\d{2})\s/.test(lines[0] ?? "");
}

function tickKeyboard(tasks: Array<{ id: number; position: number; completed: boolean }>, revision: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  addTickButtons(keyboard, tasks, revision);
  return keyboard;
}

function addTickButtons(keyboard: InlineKeyboard, tasks: Array<{ id: number; position: number; completed: boolean }>, revision: number): void {
  const perRow = tasks.length <= 8 ? Math.max(tasks.length, 1) : tasks.length <= 16 ? Math.ceil(tasks.length / 2) : 8;
  tasks.forEach((task, index) => {
    keyboard.text(task.completed ? `✅${task.position + 1}` : `${task.position + 1}`, `pc:${task.id}:${revision}:${task.completed ? 0 : 1}`);
    if ((index + 1) % perRow === 0) keyboard.row();
  });
}

async function deliverPlanCopies(
  bot: Bot,
  plan: NonNullable<Awaited<ReturnType<typeof getPlan>>>,
  owner: { name: string; telegram_id: string; started_at: Date | null },
  date: string,
): Promise<void> {
  const done = plan.tasks.filter((task) => task.completed).length;
  const text = [
    `📋 ${owner.name} — ${displayDate(date)}`,
    `Bajarildi: ${done}/${plan.tasks.length}`,
    "",
    ...plan.tasks.map((task) => formatTaskLine(task, task.completed)),
  ].join("\n");
  const markup = { inline_keyboard: tickKeyboard(plan.tasks, plan.revision).inline_keyboard };
  const dest = await forumDestination("daily");
  if (dest) {
    if (plan.forumMessageId) {
      await bot.api.editMessageText(dest.chatId, plan.forumMessageId, text, { reply_markup: markup });
    } else {
      const sent = await bot.api.sendMessage(dest.chatId, text, { message_thread_id: dest.topicId, reply_markup: markup });
      await rememberPlanMessage(plan.id, "forum", dest.chatId, sent.message_id, dest.topicId);
    }
  }
  if (owner.started_at) {
    if (plan.privateMessageId && plan.privateChatId) {
      await bot.api.editMessageText(plan.privateChatId, plan.privateMessageId, text, { reply_markup: markup });
    } else {
      const sent = await bot.api.sendMessage(owner.telegram_id, text, { reply_markup: markup });
      await rememberPlanMessage(plan.id, "private", owner.telegram_id, sent.message_id, null);
    }
  }
}

function displayDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day ?? ""}.${month ?? ""}.${year ?? ""}`;
}

function endOfDay(date: string): Date {
  return zonedTimeToUtc(shiftDate(date, 1), "00:00", config.timezone);
}
