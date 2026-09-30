import { query } from "./db.js";

export type ReplyKind = "voice" | "video_note" | "audio" | "video" | "video_file" | "youtube";

export type PendingKind = "feedback" | "explain" | "todo" | "judgment" | "announcement" | "note" | "exercise";

export type UserRow = {
  id: number;
  telegram_id: string;
  name: string;
  username: string | null;
  role: string;
  pending: string | null;
  started_at: Date | null;
  created_at: Date;
  blocked_at?: Date | null;
  blocked_by?: string | null;
  private_reachable?: boolean | null;
  pending_payload?: unknown;
  pending_expires_at?: Date | null;
};

export type TopicSlot = "daily" | "unusual" | "reminders" | "exercises";

export type Settings = {
  wake_time: string;
  topic_time: string;
  report_time: string;
  on_time: string;
  explain_time: string;
  plan_deadline: string;
  response_deadline: string;
  grace_minutes: number;
  topic_schedule_enabled: boolean;
  topic_daily_id: number | null;
  topic_unusual_id: number | null;
  topic_reminders_id: number | null;
  topic_exercises_id: number | null;
};

export type SettingKey = "wake" | "topic" | "report" | "ontime" | "explain" | "plan" | "response";

export const settingColumns: Record<SettingKey, keyof Settings> = {
  wake: "wake_time",
  topic: "topic_time",
  report: "report_time",
  ontime: "on_time",
  explain: "explain_time",
  plan: "plan_deadline",
  response: "response_deadline",
};

const settingsColumns =
  "wake_time, topic_time, report_time, on_time, explain_time, plan_deadline, response_deadline, grace_minutes, topic_schedule_enabled, topic_daily_id::text AS topic_daily_id, topic_unusual_id::text AS topic_unusual_id, topic_reminders_id::text AS topic_reminders_id, topic_exercises_id::text AS topic_exercises_id";

export type DailyStats = {
  started: number;
  wakes: number;
  topicSent: number;
  replies: number;
};

export type TopicListItem = {
  id: number;
  text: string;
  last_used_on: string | null;
};

export type DayStatus = {
  id: number;
  topic_sent_at: Date | null;
  reply_at: Date | null;
  topic_id: number | null;
};

const userColumns = `
  id,
  telegram_id::text AS telegram_id,
  name,
  username,
  role,
  pending,
  started_at,
  created_at,
  blocked_at,
  blocked_by::text AS blocked_by,
  private_reachable,
  pending_payload,
  pending_expires_at
`;

export async function findUser(telegramId: string): Promise<UserRow | null> {
  const result = await query<UserRow>(
    `SELECT ${userColumns} FROM users WHERE telegram_id = $1::bigint`,
    [telegramId],
  );
  return result.rows[0] ?? null;
}

export async function upsertUser(input: {
  telegramId: string;
  name: string;
  username: string | null;
  makeAdmin: boolean;
  started: boolean;
}): Promise<UserRow> {
  const role = input.makeAdmin ? "admin" : "member";
  const result = await query<UserRow>(
    `INSERT INTO users (telegram_id, name, username, role, started_at, private_reachable)
     VALUES ($1::bigint, $2, $3, $4, CASE WHEN $5 THEN now() ELSE NULL END, CASE WHEN $5 THEN true ELSE NULL END)
     ON CONFLICT (telegram_id) DO UPDATE SET
       name = EXCLUDED.name,
       username = EXCLUDED.username,
       role = CASE
         WHEN EXCLUDED.role = 'admin' OR users.role = 'admin' THEN 'admin'
         ELSE users.role
       END,
       started_at = COALESCE(users.started_at, EXCLUDED.started_at),
       private_reachable = CASE WHEN $5 THEN true ELSE users.private_reachable END
     RETURNING ${userColumns}`,
    [input.telegramId, input.name, input.username, role, input.started],
  );
  const row = result.rows[0];
  if (!row) throw new Error("upsert user returned no row");
  return row;
}

export async function updateUserProfile(
  userId: number,
  name: string,
  username: string | null,
): Promise<void> {
  await query("UPDATE users SET name = $2, username = $3 WHERE id = $1", [userId, name, username]);
}

export async function recordWake(
  userId: number,
  date: string,
): Promise<{ already: boolean; wakeUpAt: Date }> {
  const inserted = await query<{ wake_up_at: Date }>(
    `INSERT INTO days (user_id, date, wake_up_at)
     VALUES ($1, $2::date, now())
     ON CONFLICT (user_id, date) DO UPDATE
     SET wake_up_at = EXCLUDED.wake_up_at
     WHERE days.wake_up_at IS NULL
     RETURNING wake_up_at`,
    [userId, date],
  );
  const fresh = inserted.rows[0]?.wake_up_at;
  if (fresh) return { already: false, wakeUpAt: fresh };

  const existing = await query<{ wake_up_at: Date }>(
    `SELECT wake_up_at FROM days WHERE user_id = $1 AND date = $2::date AND wake_up_at IS NOT NULL`,
    [userId, date],
  );
  const wakeUpAt = existing.rows[0]?.wake_up_at;
  if (!wakeUpAt) throw new Error("wake row missing after upsert");
  return { already: true, wakeUpAt };
}

export async function getDailyStats(date: string): Promise<DailyStats> {
  const result = await query<{
    started: number;
    wakes: number;
    topic_sent: number;
    replies: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM users WHERE started_at IS NOT NULL) AS started,
       (SELECT count(*)::int FROM days WHERE date = $1::date AND wake_up_at IS NOT NULL) AS wakes,
       (SELECT count(*)::int FROM days WHERE date = $1::date AND topic_sent_at IS NOT NULL) AS topic_sent,
       (SELECT count(*)::int FROM days WHERE date = $1::date AND reply_at IS NOT NULL) AS replies`,
    [date],
  );
  const row = result.rows[0];
  if (!row) throw new Error("stats query returned no row");
  return {
    started: row.started,
    wakes: row.wakes,
    topicSent: row.topic_sent,
    replies: row.replies,
  };
}

export async function getGroupChatId(): Promise<string | null> {
  await query("INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
  const result = await query<{ group_chat_id: string | null }>(
    "SELECT group_chat_id FROM settings WHERE id = 1",
  );
  const id = result.rows[0]?.group_chat_id?.trim() ?? "";
  return id || null;
}

/** Copy GROUP_CHAT_ID from the environment only when nothing is saved yet. */
export async function seedGroupChatId(fallback: string | null): Promise<string | null> {
  const current = await getGroupChatId();
  if (current) return current;
  if (!fallback) return null;
  await setGroupChatId(fallback);
  return fallback;
}

export async function setGroupChatId(chatId: string): Promise<void> {
  if (!/^-?\d+$/.test(chatId)) throw new Error("group chat id must be numeric");
  await query("INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
  await query(
    `UPDATE settings SET group_chat_id = $1,
       topic_daily_id = CASE WHEN group_chat_id IS DISTINCT FROM $1 THEN NULL ELSE topic_daily_id END,
       topic_unusual_id = CASE WHEN group_chat_id IS DISTINCT FROM $1 THEN NULL ELSE topic_unusual_id END,
       topic_reminders_id = CASE WHEN group_chat_id IS DISTINCT FROM $1 THEN NULL ELSE topic_reminders_id END,
       topic_exercises_id = CASE WHEN group_chat_id IS DISTINCT FROM $1 THEN NULL ELSE topic_exercises_id END
     WHERE id = 1`,
    [chatId],
  );
}

export async function getSettings(): Promise<Settings> {
  await query("INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
  const result = await query<Settings & Record<string, unknown>>(
    `SELECT ${settingsColumns} FROM settings WHERE id = 1`,
  );
  const row = result.rows[0];
  if (!row) throw new Error("settings row missing");
  return normalizeSettings(row);
}

function normalizeSettings(row: Settings & Record<string, unknown>): Settings {
  return {
    wake_time: row.wake_time,
    topic_time: row.topic_time,
    report_time: row.report_time,
    on_time: row.on_time,
    explain_time: row.explain_time,
    plan_deadline: row.plan_deadline || "09:00",
    response_deadline: row.response_deadline || "20:00",
    grace_minutes: Number(row.grace_minutes ?? 60),
    topic_schedule_enabled: row.topic_schedule_enabled !== false,
    topic_daily_id: asTopicId(row.topic_daily_id),
    topic_unusual_id: asTopicId(row.topic_unusual_id),
    topic_reminders_id: asTopicId(row.topic_reminders_id),
    topic_exercises_id: asTopicId(row.topic_exercises_id),
  };
}

function asTopicId(value: unknown): number | null {
  if (value == null || value === "") return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export function topicId(settings: Settings, slot: TopicSlot): number | null {
  if (slot === "daily") return settings.topic_daily_id;
  if (slot === "unusual") return settings.topic_unusual_id;
  if (slot === "reminders") return settings.topic_reminders_id;
  return settings.topic_exercises_id;
}

export async function bindTopic(slot: TopicSlot, topicIdValue: number): Promise<void> {
  const column = {
    daily: "topic_daily_id",
    unusual: "topic_unusual_id",
    reminders: "topic_reminders_id",
    exercises: "topic_exercises_id",
  }[slot];
  await query(`UPDATE settings SET ${column} = $1 WHERE id = 1`, [topicIdValue]);
}

export async function setTopicScheduleEnabled(enabled: boolean): Promise<Settings> {
  const result = await query<Settings & Record<string, unknown>>(
    `UPDATE settings SET topic_schedule_enabled = $1 WHERE id = 1 RETURNING ${settingsColumns}`,
    [enabled],
  );
  const row = result.rows[0];
  if (!row) throw new Error("settings update returned no row");
  return normalizeSettings(row);
}

export async function setGraceMinutes(minutes: number): Promise<Settings> {
  const result = await query<Settings & Record<string, unknown>>(
    `UPDATE settings SET grace_minutes = $1 WHERE id = 1 RETURNING ${settingsColumns}`,
    [minutes],
  );
  const row = result.rows[0];
  if (!row) throw new Error("settings update returned no row");
  return normalizeSettings(row);
}

export async function updateSetting(key: SettingKey, hhmm: string): Promise<Settings> {
  const column = settingColumns[key];
  const result = await query<Settings & Record<string, unknown>>(
    `UPDATE settings SET ${column} = $1 WHERE id = 1
     RETURNING ${settingsColumns}`,
    [hhmm],
  );
  const row = result.rows[0];
  if (!row) throw new Error("settings update returned no row");
  return normalizeSettings(row);
}

export async function getDayPost(date: string, kind: string): Promise<number | null> {
  const result = await query<{ message_id: string }>(
    `SELECT message_id::text AS message_id
     FROM day_posts WHERE date = $1::date AND kind = $2`,
    [date, kind],
  );
  const raw = result.rows[0]?.message_id;
  if (!raw) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export async function saveDayPost(
  date: string,
  kind: string,
  messageId: number,
  dest: { chatId: string; topicId: number | null; partIndex?: number } | null = null,
): Promise<void> {
  const partIndex = dest?.partIndex ?? 0;
  await query(
    `INSERT INTO day_posts (date, kind, message_id, chat_id, topic_id, part_index)
     VALUES ($1::date, $2, $3, $4::bigint, $5, $6)
     ON CONFLICT (date, kind, part_index) DO UPDATE
     SET message_id = EXCLUDED.message_id,
         chat_id = COALESCE(EXCLUDED.chat_id, day_posts.chat_id),
         topic_id = COALESCE(EXCLUDED.topic_id, day_posts.topic_id)`,
    [date, kind, messageId, dest?.chatId ?? null, dest?.topicId ?? null, partIndex],
  );
}

export type TrackedPost = {
  date: string;
  kind: string;
  messageId: number;
  chatId: string | null;
  topicId: number | null;
  partIndex: number;
};

export async function wakePostsThrough(date: string): Promise<TrackedPost[]> {
  return listDayPostsThrough("wake", date);
}

export async function listDayPosts(date: string, kind: string): Promise<TrackedPost[]> {
  const result = await query<{
    date: string;
    kind: string;
    message_id: string;
    chat_id: string | null;
    topic_id: string | null;
    part_index: number;
  }>(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, kind, message_id::text AS message_id,
            chat_id::text AS chat_id, topic_id::text AS topic_id, part_index
     FROM day_posts WHERE date = $1::date AND kind = $2
     ORDER BY part_index`,
    [date, kind],
  );
  return result.rows.map(mapTrackedPost);
}

async function listDayPostsThrough(kind: string, date: string): Promise<TrackedPost[]> {
  const result = await query<{
    date: string;
    kind: string;
    message_id: string;
    chat_id: string | null;
    topic_id: string | null;
    part_index: number;
  }>(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, kind, message_id::text AS message_id,
            chat_id::text AS chat_id, topic_id::text AS topic_id, part_index
     FROM day_posts WHERE kind = $2 AND date <= $1::date
     ORDER BY date, part_index`,
    [date, kind],
  );
  return result.rows.map(mapTrackedPost);
}

function mapTrackedPost(row: {
  date: string;
  kind: string;
  message_id: string;
  chat_id: string | null;
  topic_id: string | null;
  part_index: number;
}): TrackedPost {
  const messageId = Number(row.message_id);
  const topic = row.topic_id == null ? null : Number(row.topic_id);
  return {
    date: row.date,
    kind: row.kind,
    messageId: Number.isSafeInteger(messageId) ? messageId : 0,
    chatId: row.chat_id,
    topicId: topic != null && Number.isSafeInteger(topic) ? topic : null,
    partIndex: row.part_index ?? 0,
  };
}

export async function removeWakePost(date: string): Promise<void> {
  await query("DELETE FROM day_posts WHERE date = $1::date AND kind = 'wake'", [date]);
}

export async function listRecentTopics(limit = 10): Promise<TopicListItem[]> {
  const result = await query<TopicListItem>(
    `SELECT id, text, to_char(last_used_on, 'YYYY-MM-DD') AS last_used_on
     FROM topics
     ORDER BY id DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export async function insertTopic(text: string): Promise<number> {
  const result = await query<{ id: number }>(
    "INSERT INTO topics (text) VALUES ($1) RETURNING id",
    [text],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("topic insert returned no id");
  return id;
}

/** One shared topic for the date. Reuses today's topic if the job runs again. */
export async function takeTodayTopic(date: string): Promise<{ id: number; text: string } | null> {
  const existing = await query<{ id: number; text: string }>(
    `SELECT id, text FROM topics WHERE last_used_on = $1::date ORDER BY id LIMIT 1`,
    [date],
  );
  if (existing.rows[0]) return existing.rows[0];

  const picked = await query<{ id: number; text: string }>(
    `UPDATE topics SET last_used_on = $1::date
     WHERE id = (
       SELECT id FROM topics
       ORDER BY last_used_on NULLS FIRST, last_used_on ASC, id ASC
       LIMIT 1
     )
     AND NOT EXISTS (SELECT 1 FROM topics WHERE last_used_on = $1::date)
     RETURNING id, text`,
    [date],
  );
  return picked.rows[0] ?? null;
}

export async function listStartedWakeTimes(date: string): Promise<
  Array<{ telegramId: string; name: string; username: string | null; wakeUpAt: Date | null; wakeCard: string | null }>
> {
  const result = await query<{
    telegram_id: string;
    name: string;
    username: string | null;
    wake_up_at: Date | null;
    wake_card: string | null;
  }>(
    `SELECT u.telegram_id::text AS telegram_id, u.name, u.username, d.wake_up_at, d.wake_card
     FROM users u
     LEFT JOIN days d ON d.user_id = u.id AND d.date = $1::date
     WHERE u.started_at IS NOT NULL
     ORDER BY d.wake_up_at ASC NULLS LAST, lower(u.name) ASC`,
    [date],
  );
  return result.rows.map((row) => ({
    telegramId: row.telegram_id,
    name: row.name,
    username: row.username,
    wakeUpAt: row.wake_up_at,
    wakeCard: row.wake_card,
  }));
}

export async function setWakeCard(userId: number, date: string, card: "green" | "orange" | "red" | "yellow"): Promise<void> {
  await query(
    `INSERT INTO days (user_id, date, wake_card, explanation_status)
     VALUES ($1, $2::date, $3, CASE WHEN $3 = 'yellow' THEN 'excused' WHEN $3 = 'green' THEN NULL ELSE 'tasked' END)
     ON CONFLICT (user_id, date) DO UPDATE
     SET wake_card = EXCLUDED.wake_card,
         explanation_status = CASE
           WHEN EXCLUDED.wake_card = 'yellow' THEN 'excused'
           WHEN EXCLUDED.wake_card = 'green' THEN days.explanation_status
           ELSE 'tasked'
         END`,
    [userId, date, card],
  );
}

export async function countWakeCards(userId: number): Promise<{ red: number; orange: number }> {
  const result = await query<{ red: number; orange: number }>(
    `SELECT
       count(*) FILTER (WHERE wake_card = 'red')::int AS red,
       count(*) FILTER (WHERE wake_card = 'orange')::int AS orange
     FROM days
     WHERE user_id = $1`,
    [userId],
  );
  return { red: result.rows[0]?.red ?? 0, orange: result.rows[0]?.orange ?? 0 };
}

export type AccountRow = {
  telegramId: string;
  name: string;
  username: string | null;
  startedAt: Date;
  date: string | null;
  wakeUpAt: Date | null;
  topicSentAt: Date | null;
  replyAt: Date | null;
  topicText: string | null;
  explanation: string | null;
  wakeCard: string | null;
};

export async function listAccountRows(fromDate: string, toDate: string): Promise<AccountRow[]> {
  const result = await query<{
    telegram_id: string;
    name: string;
    username: string | null;
    started_at: Date;
    date: string | null;
    wake_up_at: Date | null;
    topic_sent_at: Date | null;
    reply_at: Date | null;
    topic_text: string | null;
    explanation: string | null;
    wake_card: string | null;
  }>(
    `SELECT
       u.telegram_id::text AS telegram_id,
       u.name,
       u.username,
       u.started_at,
       to_char(d.date, 'YYYY-MM-DD') AS date,
       d.wake_up_at,
       d.topic_sent_at,
       d.reply_at,
       t.text AS topic_text,
       d.explanation,
       d.wake_card
     FROM users u
     LEFT JOIN days d ON d.user_id = u.id AND d.date >= $1::date AND d.date <= $2::date
     LEFT JOIN topics t ON t.id = d.topic_id
     WHERE u.started_at IS NOT NULL
     ORDER BY lower(u.name), d.date`,
    [fromDate, toDate],
  );
  return result.rows.map((row) => ({
    telegramId: row.telegram_id,
    name: row.name,
    username: row.username,
    startedAt: row.started_at,
    date: row.date,
    wakeUpAt: row.wake_up_at,
    topicSentAt: row.topic_sent_at,
    replyAt: row.reply_at,
    topicText: row.topic_text,
    explanation: row.explanation,
    wakeCard: row.wake_card,
  }));
}

export async function getDayNote(
  userId: number,
  date: string,
): Promise<{ wakeUpAt: Date | null; explanation: string | null; explanationStatus: string | null; wakeCard: string | null } | null> {
  const result = await query<{ wake_up_at: Date | null; explanation: string | null; explanation_status: string | null; wake_card: string | null }>(
    `SELECT wake_up_at, explanation, explanation_status, wake_card FROM days WHERE user_id = $1 AND date = $2::date`,
    [userId, date],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { wakeUpAt: row.wake_up_at, explanation: row.explanation, explanationStatus: row.explanation_status, wakeCard: row.wake_card };
}

export async function saveExplanation(userId: number, date: string, text: string): Promise<void> {
  await query(
    `INSERT INTO days (user_id, date, explanation, explanation_at, explanation_status)
     VALUES ($1, $2::date, $3, now(), 'pending')
     ON CONFLICT (user_id, date) DO UPDATE
     SET explanation = EXCLUDED.explanation,
         explanation_at = now(),
         explanation_status = CASE
           WHEN days.explanation_status IN ('excused', 'tasked') THEN days.explanation_status
           ELSE 'pending'
         END`,
    [userId, date, text],
  );
}

export async function claimExplanationReview(
  userId: number,
  date: string,
  status: "excused" | "tasked",
): Promise<"ok" | "closed" | "missing"> {
  const result = await query<{ explanation_status: string }>(
    `UPDATE days SET explanation_status = $3
     WHERE user_id = $1 AND date = $2::date AND explanation_status = 'pending'
     RETURNING explanation_status`,
    [userId, date, status],
  );
  if (result.rows[0]) return "ok";
  const current = await query<{ explanation_status: string | null }>(
    `SELECT explanation_status FROM days WHERE user_id = $1 AND date = $2::date`,
    [userId, date],
  );
  if (!current.rows[0]) return "missing";
  return "closed";
}

export async function explanationOwner(
  userId: number,
  date: string,
): Promise<{
  telegramId: string;
  name: string;
  username: string | null;
  explanation: string | null;
  wakeUpAt: Date | null;
  startedAt: Date | null;
  wakeCard: string | null;
  blockReason: string | null;
} | null> {
  const result = await query<{
    telegram_id: string;
    name: string;
    username: string | null;
    explanation: string | null;
    wake_up_at: Date | null;
    started_at: Date | null;
    wake_card: string | null;
    block_reason: string | null;
  }>(
    `SELECT u.telegram_id::text AS telegram_id, u.name, u.username, d.explanation, d.wake_up_at,
            u.started_at, d.wake_card, u.block_reason
     FROM days d
     JOIN users u ON u.id = d.user_id
     WHERE d.user_id = $1 AND d.date = $2::date`,
    [userId, date],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    telegramId: row.telegram_id,
    name: row.name,
    username: row.username,
    explanation: row.explanation,
    wakeUpAt: row.wake_up_at,
    startedAt: row.started_at,
    wakeCard: row.wake_card,
    blockReason: row.block_reason,
  };
}

export async function setUserPending(
  userId: number,
  pending: PendingKind | null,
  payload: unknown = null,
  expiresAt: Date | null = null,
): Promise<void> {
  await query(
    `UPDATE users
     SET pending = $2, pending_payload = $3::jsonb, pending_expires_at = $4
     WHERE id = $1`,
    [userId, pending, payload == null ? null : JSON.stringify(payload), expiresAt],
  );
}

export function pendingActive(user: UserRow, now = new Date()): string | null {
  if (!user.pending) return null;
  if (user.pending_expires_at && user.pending_expires_at.getTime() <= now.getTime()) return null;
  return user.pending;
}

export async function clearUserPending(telegramId: string): Promise<void> {
  await query(
    `UPDATE users SET pending = NULL
     WHERE telegram_id = $1::bigint AND pending IS NOT NULL`,
    [telegramId],
  );
}

export async function insertFeedback(userId: number, text: string): Promise<void> {
  await query("INSERT INTO feedback (user_id, text) VALUES ($1, $2)", [userId, text]);
}

export async function listRecentFeedback(limit = 15): Promise<
  Array<{
    text: string;
    createdAt: Date;
    telegramId: string;
    name: string;
    username: string | null;
  }>
> {
  const result = await query<{
    text: string;
    created_at: Date;
    telegram_id: string;
    name: string;
    username: string | null;
  }>(
    `SELECT f.text, f.created_at, u.telegram_id::text AS telegram_id, u.name, u.username
     FROM feedback f
     JOIN users u ON u.id = f.user_id
     ORDER BY f.id DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    text: row.text,
    createdAt: row.created_at,
    telegramId: row.telegram_id,
    name: row.name,
    username: row.username,
  }));
}

export async function listStartedUsers(): Promise<
  Array<{ id: number; telegram_id: string; name: string }>
> {
  const result = await query<{ id: number; telegram_id: string; name: string }>(
    `SELECT id, telegram_id::text AS telegram_id, name
     FROM users
     WHERE started_at IS NOT NULL
     ORDER BY id`,
  );
  return result.rows;
}

export async function ensureDay(userId: number, date: string): Promise<void> {
  await query(
    `INSERT INTO days (user_id, date) VALUES ($1, $2::date)
     ON CONFLICT (user_id, date) DO NOTHING`,
    [userId, date],
  );
}

export async function getDayStatus(userId: number, date: string): Promise<DayStatus | null> {
  const result = await query<DayStatus>(
    `SELECT id, topic_sent_at, reply_at, topic_id
     FROM days WHERE user_id = $1 AND date = $2::date`,
    [userId, date],
  );
  return result.rows[0] ?? null;
}

export async function markTopicSent(userId: number, date: string, topicId: number): Promise<void> {
  await query(
    `UPDATE days
     SET topic_id = $3, topic_sent_at = now()
     WHERE user_id = $1 AND date = $2::date AND topic_sent_at IS NULL`,
    [userId, date, topicId],
  );
}

/** Accept today's reply without claiming the forum copy succeeded. */
export async function claimReply(
  userId: number,
  date: string,
  fileId: string,
  kind: ReplyKind,
  source: "private" | "forum",
  extra: { chatId?: string | null; messageId?: number | null; youtubeUrl?: string | null } = {},
): Promise<{ dayId: number; duplicate: boolean } | null> {
  const existing = await query<{ id: number; reply_at: Date | null }>(
    `SELECT id, reply_at FROM days
     WHERE user_id = $1 AND date = $2::date AND topic_id IS NOT NULL`,
    [userId, date],
  );
  const row = existing.rows[0];
  if (!row) return null;
  if (row.reply_at) return { dayId: row.id, duplicate: true };
  const claimed = await query<{ id: number }>(
    `UPDATE days
     SET reply_file_id = $1, reply_kind = $2, reply_at = now(),
         response_source = $3, publication_status = $4,
         response_chat_id = $5::bigint, response_message_id = $6, youtube_url = $7
     WHERE id = $8 AND reply_at IS NULL
     RETURNING id`,
    [
      fileId,
      kind,
      source,
      source === "forum" ? "original" : "pending",
      extra.chatId ?? null,
      extra.messageId ?? null,
      extra.youtubeUrl ?? null,
      row.id,
    ],
  );
  const dayId = claimed.rows[0]?.id;
  if (!dayId) return { dayId: row.id, duplicate: true };
  return { dayId, duplicate: false };
}

export async function markReplyPublished(dayId: number, messageId: number, chatId: string): Promise<void> {
  await query(
    `UPDATE days
     SET publication_status = 'published', publication_error = NULL,
         response_message_id = $2, response_chat_id = $3::bigint
     WHERE id = $1`,
    [dayId, messageId, chatId],
  );
}

export async function markReplyPublishFailed(dayId: number, error: string): Promise<void> {
  await query(
    `UPDATE days SET publication_status = 'failed', publication_error = $2 WHERE id = $1`,
    [dayId, error.slice(0, 500)],
  );
}

export async function clearReply(dayId: number): Promise<void> {
  await query(
    `UPDATE days
     SET reply_file_id = NULL, reply_kind = NULL, reply_at = NULL
     WHERE id = $1`,
    [dayId],
  );
}
