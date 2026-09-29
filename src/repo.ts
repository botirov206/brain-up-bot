import { query } from "./db.js";

export type ReplyKind = "voice" | "video_note" | "audio";

export type UserRow = {
  id: number;
  telegram_id: string;
  name: string;
  username: string | null;
  role: string;
  pending: string | null;
  started_at: Date | null;
  created_at: Date;
};

export type Settings = {
  wake_time: string;
  topic_time: string;
  report_time: string;
  on_time: string;
  explain_time: string;
};

export type SettingKey = "wake" | "topic" | "report" | "ontime" | "explain";

export const settingColumns: Record<SettingKey, keyof Settings> = {
  wake: "wake_time",
  topic: "topic_time",
  report: "report_time",
  ontime: "on_time",
  explain: "explain_time",
};

const settingsColumns = "wake_time, topic_time, report_time, on_time, explain_time";

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
};

const userColumns = `
  id,
  telegram_id::text AS telegram_id,
  name,
  username,
  role,
  pending,
  started_at,
  created_at
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
    `INSERT INTO users (telegram_id, name, username, role, started_at)
     VALUES ($1::bigint, $2, $3, $4, CASE WHEN $5 THEN now() ELSE NULL END)
     ON CONFLICT (telegram_id) DO UPDATE SET
       name = EXCLUDED.name,
       username = EXCLUDED.username,
       role = CASE
         WHEN EXCLUDED.role = 'admin' OR users.role = 'admin' THEN 'admin'
         ELSE users.role
       END,
       started_at = COALESCE(users.started_at, EXCLUDED.started_at)
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
  await query("UPDATE settings SET group_chat_id = $1 WHERE id = 1", [chatId]);
}

export async function getSettings(): Promise<Settings> {
  await query("INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
  const result = await query<Settings>(
    `SELECT ${settingsColumns} FROM settings WHERE id = 1`,
  );
  const row = result.rows[0];
  if (!row) throw new Error("settings row missing");
  return row;
}

export async function updateSetting(key: SettingKey, hhmm: string): Promise<Settings> {
  const column = settingColumns[key];
  const result = await query<Settings>(
    `UPDATE settings SET ${column} = $1 WHERE id = 1
     RETURNING ${settingsColumns}`,
    [hhmm],
  );
  const row = result.rows[0];
  if (!row) throw new Error("settings update returned no row");
  return row;
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

export async function saveDayPost(date: string, kind: string, messageId: number): Promise<void> {
  await query(
    `INSERT INTO day_posts (date, kind, message_id)
     VALUES ($1::date, $2, $3)
     ON CONFLICT (date, kind) DO UPDATE SET message_id = EXCLUDED.message_id`,
    [date, kind, messageId],
  );
}

export async function wakePostsThrough(date: string): Promise<Array<{ date: string; messageId: number }>> {
  const result = await query<{ date: string; message_id: string }>(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, message_id::text AS message_id
     FROM day_posts WHERE kind = 'wake' AND date <= $1::date ORDER BY date`,
    [date],
  );
  return result.rows.map((row) => ({ date: row.date, messageId: Number(row.message_id) }));
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
  Array<{ telegramId: string; name: string; username: string | null; wakeUpAt: Date | null }>
> {
  const result = await query<{
    telegram_id: string;
    name: string;
    username: string | null;
    wake_up_at: Date | null;
  }>(
    `SELECT u.telegram_id::text AS telegram_id, u.name, u.username, d.wake_up_at
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
  }));
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
       d.explanation
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
  }));
}

export async function getDayNote(
  userId: number,
  date: string,
): Promise<{ wakeUpAt: Date | null; explanation: string | null } | null> {
  const result = await query<{ wake_up_at: Date | null; explanation: string | null }>(
    `SELECT wake_up_at, explanation FROM days WHERE user_id = $1 AND date = $2::date`,
    [userId, date],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { wakeUpAt: row.wake_up_at, explanation: row.explanation };
}

export async function saveExplanation(userId: number, date: string, text: string): Promise<void> {
  await query(
    `INSERT INTO days (user_id, date, explanation, explanation_at)
     VALUES ($1, $2::date, $3, now())
     ON CONFLICT (user_id, date) DO UPDATE
     SET explanation = EXCLUDED.explanation, explanation_at = now()`,
    [userId, date, text],
  );
}

export async function setUserPending(userId: number, pending: "feedback" | "explain" | null): Promise<void> {
  await query("UPDATE users SET pending = $2 WHERE id = $1", [userId, pending]);
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
    `SELECT id, topic_sent_at, reply_at
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

/** Claim today's reply slot. Returns the day id, or null if it was not claimable. */
export async function claimReply(
  userId: number,
  date: string,
  fileId: string,
  kind: ReplyKind,
): Promise<number | null> {
  const result = await query<{ id: number }>(
    `UPDATE days
     SET reply_file_id = $1, reply_kind = $2, reply_at = now()
     WHERE user_id = $3 AND date = $4::date
       AND topic_sent_at IS NOT NULL
       AND reply_at IS NULL
     RETURNING id`,
    [fileId, kind, userId, date],
  );
  return result.rows[0]?.id ?? null;
}

export async function clearReply(dayId: number): Promise<void> {
  await query(
    `UPDATE days
     SET reply_file_id = NULL, reply_kind = NULL, reply_at = NULL
     WHERE id = $1`,
    [dayId],
  );
}
