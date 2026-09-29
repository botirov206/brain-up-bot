import { query } from "./db.js";

export type ReplyKind = "voice" | "video_note" | "audio";

export type UserRow = {
  id: number;
  telegram_id: string;
  name: string;
  username: string | null;
  role: string;
  started_at: Date | null;
  created_at: Date;
};

export type Settings = {
  wake_time: string;
  topic_time: string;
  report_time: string;
};

export type SettingKey = "wake" | "topic" | "report";

const settingColumns: Record<SettingKey, "wake_time" | "topic_time" | "report_time"> = {
  wake: "wake_time",
  topic: "topic_time",
  report: "report_time",
};

export type DailyStats = {
  started: number;
  notStarted: number;
  wakes: number;
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

export async function upsertStartedUser(input: {
  telegramId: string;
  name: string;
  username: string | null;
  makeAdmin: boolean;
}): Promise<UserRow> {
  const role = input.makeAdmin ? "admin" : "member";
  const result = await query<UserRow>(
    `INSERT INTO users (telegram_id, name, username, role, started_at)
     VALUES ($1::bigint, $2, $3, $4, now())
     ON CONFLICT (telegram_id) DO UPDATE SET
       name = EXCLUDED.name,
       username = EXCLUDED.username,
       role = CASE
         WHEN EXCLUDED.role = 'admin' OR users.role = 'admin' THEN 'admin'
         ELSE users.role
       END,
       started_at = COALESCE(users.started_at, now())
     RETURNING ${userColumns}`,
    [input.telegramId, input.name, input.username, role],
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
    not_started: number;
    wakes: number;
    replies: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM users WHERE started_at IS NOT NULL) AS started,
       (SELECT count(*)::int FROM users WHERE started_at IS NULL) AS not_started,
       (SELECT count(*)::int FROM days WHERE date = $1::date AND wake_up_at IS NOT NULL) AS wakes,
       (SELECT count(*)::int FROM days WHERE date = $1::date AND reply_at IS NOT NULL) AS replies`,
    [date],
  );
  const row = result.rows[0];
  if (!row) throw new Error("stats query returned no row");
  return {
    started: row.started,
    notStarted: row.not_started,
    wakes: row.wakes,
    replies: row.replies,
  };
}

export async function getSettings(): Promise<Settings> {
  await query("INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
  const result = await query<Settings>(
    "SELECT wake_time, topic_time, report_time FROM settings WHERE id = 1",
  );
  const row = result.rows[0];
  if (!row) throw new Error("settings row missing");
  return row;
}

export async function updateSetting(key: SettingKey, hhmm: string): Promise<Settings> {
  const column = settingColumns[key];
  if (column !== "wake_time" && column !== "topic_time" && column !== "report_time") {
    throw new Error("unexpected settings column");
  }
  const result = await query<Settings>(
    `UPDATE settings SET ${column} = $1 WHERE id = 1
     RETURNING wake_time, topic_time, report_time`,
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
