import { query } from "./db.js";
import type { MembershipCheck } from "./membership.js";
import type { ParsedTask } from "./todo-parse.js";
import type { ReplyKind } from "./repo.js";

export type MemberListRow = {
  id: number;
  telegramId: string;
  name: string;
  username: string | null;
  startedAt: Date | null;
  blockedAt: Date | null;
  privateReachable: boolean | null;
  telegramStatus: string;
  isMember: boolean;
  admittedAt: Date | null;
};

export type DeliveryRow = {
  id: number;
  logicalKey: string;
  operation: string;
  subject: string | null;
  chatId: string | null;
  topicId: number | null;
  status: string;
  attempts: number;
  payload: Record<string, unknown>;
};

export async function saveMembership(chatId: string, telegramId: string, check: MembershipCheck): Promise<void> {
  if (check.kind === "unavailable") return;
  const member = check.kind === "member";
  await query(
    `INSERT INTO forum_memberships (forum_chat_id, telegram_id, telegram_status, is_member, verified_at, admitted_at)
     VALUES ($1::bigint, $2::bigint, $3, $4, now(), CASE WHEN $4 THEN now() ELSE NULL END)
     ON CONFLICT (forum_chat_id, telegram_id) DO UPDATE SET
       telegram_status = EXCLUDED.telegram_status,
       is_member = EXCLUDED.is_member,
       verified_at = now(),
       admitted_at = CASE
         WHEN EXCLUDED.is_member AND (forum_memberships.is_member = false OR forum_memberships.admitted_at IS NULL) THEN now()
         WHEN EXCLUDED.is_member THEN forum_memberships.admitted_at
         ELSE forum_memberships.admitted_at
       END`,
    [chatId, telegramId, check.telegramStatus, member],
  );
}

export async function listKnownTelegramIds(chatId: string): Promise<string[]> {
  const result = await query<{ telegram_id: string }>(
    `SELECT telegram_id::text AS telegram_id FROM (
       SELECT telegram_id FROM users
       UNION
       SELECT telegram_id FROM forum_memberships WHERE forum_chat_id = $1::bigint
     ) ids
     ORDER BY telegram_id`,
    [chatId],
  );
  return result.rows.map((row) => row.telegram_id);
}

export async function setBotForumStatus(status: string): Promise<void> {
  await query("UPDATE settings SET bot_forum_status = $1 WHERE id = 1", [status]);
}

const memberSelect = `
  SELECT u.id, u.telegram_id::text AS telegram_id, u.name, u.username, u.started_at, u.blocked_at,
         u.private_reachable, m.telegram_status, m.is_member, m.admitted_at
  FROM forum_memberships m
  JOIN users u ON u.telegram_id = m.telegram_id
  WHERE m.forum_chat_id = $1::bigint
    AND (m.is_member = true OR u.blocked_at IS NOT NULL)
`;

export async function countKnownMembers(chatId: string): Promise<number> {
  const result = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM (${memberSelect}) members`,
    [chatId],
  );
  return result.rows[0]?.count ?? 0;
}

export async function listKnownMembers(chatId: string, limit: number, offset: number): Promise<MemberListRow[]> {
  const result = await query<{
    id: number;
    telegram_id: string;
    name: string;
    username: string | null;
    started_at: Date | null;
    blocked_at: Date | null;
    private_reachable: boolean | null;
    telegram_status: string;
    is_member: boolean;
    admitted_at: Date | null;
  }>(
    `${memberSelect} ORDER BY lower(u.name), u.id LIMIT $2 OFFSET $3`,
    [chatId, limit, offset],
  );
  return result.rows.map((row) => ({
    id: row.id,
    telegramId: row.telegram_id,
    name: row.name,
    username: row.username,
    startedAt: row.started_at,
    blockedAt: row.blocked_at,
    privateReachable: row.private_reachable,
    telegramStatus: row.telegram_status,
    isMember: row.is_member,
    admittedAt: row.admitted_at,
  }));
}

export async function countActiveWaitlist(chatId: string): Promise<number> {
  const result = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM waitlist WHERE forum_chat_id = $1::bigint AND state = 'active'`,
    [chatId],
  );
  return result.rows[0]?.count ?? 0;
}

export async function joinWaitlist(userId: number, chatId: string): Promise<{ created: boolean; joinedAt: Date }> {
  const inserted = await query<{ joined_at: Date }>(
    `INSERT INTO waitlist (user_id, forum_chat_id, state, joined_at)
     VALUES ($1, $2::bigint, 'active', now())
     ON CONFLICT (user_id) WHERE state = 'active' DO NOTHING
     RETURNING joined_at`,
    [userId, chatId],
  );
  const created = inserted.rows[0];
  if (created) return { created: true, joinedAt: created.joined_at };
  const existing = await query<{ joined_at: Date }>(
    `SELECT joined_at FROM waitlist WHERE user_id = $1 AND state = 'active'`,
    [userId],
  );
  const joinedAt = existing.rows[0]?.joined_at;
  if (!joinedAt) throw new Error("waitlist join did not stick");
  return { created: false, joinedAt };
}

export async function withdrawWaitlist(userId: number): Promise<boolean> {
  const result = await query(
    `UPDATE waitlist SET state = 'withdrawn', closed_at = now()
     WHERE user_id = $1 AND state = 'active'`,
    [userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function admitWaitlist(userId: number): Promise<void> {
  await query(
    `UPDATE waitlist SET state = 'admitted', closed_at = now()
     WHERE user_id = $1 AND state = 'active'`,
    [userId],
  );
}

export async function listWaitlist(chatId: string, limit: number, offset: number): Promise<
  Array<{ id: number; name: string; username: string | null; telegramId: string; joinedAt: Date }>
> {
  const result = await query<{
    id: number;
    name: string;
    username: string | null;
    telegram_id: string;
    joined_at: Date;
  }>(
    `SELECT w.id, u.name, u.username, u.telegram_id::text AS telegram_id, w.joined_at
     FROM waitlist w
     JOIN users u ON u.id = w.user_id
     WHERE w.forum_chat_id = $1::bigint AND w.state = 'active'
     ORDER BY w.joined_at, w.id
     LIMIT $2 OFFSET $3`,
    [chatId, limit, offset],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    username: row.username,
    telegramId: row.telegram_id,
    joinedAt: row.joined_at,
  }));
}

export async function setBlocked(userId: number, byTelegramId: string, reason: string): Promise<void> {
  await query(
    `UPDATE users SET blocked_at = COALESCE(blocked_at, now()), blocked_by = $2::bigint, block_reason = $3
     WHERE id = $1`,
    [userId, byTelegramId, reason],
  );
}

export async function clearBlocked(userId: number): Promise<void> {
  await query(
    `UPDATE users SET blocked_at = NULL, blocked_by = NULL, block_reason = NULL WHERE id = $1`,
    [userId],
  );
}

export async function setPrivateReachable(telegramId: string, reachable: boolean): Promise<void> {
  await query(`UPDATE users SET private_reachable = $2 WHERE telegram_id = $1::bigint`, [telegramId, reachable]);
}

export type EligiblePerson = {
  id: number;
  telegramId: string;
  name: string;
  username: string | null;
  startedAt: Date | null;
  admittedAt: Date | null;
  privateReachable: boolean | null;
};

export async function listEligible(chatId: string): Promise<EligiblePerson[]> {
  const result = await query<{
    id: number;
    telegram_id: string;
    name: string;
    username: string | null;
    started_at: Date | null;
    admitted_at: Date | null;
    private_reachable: boolean | null;
  }>(
    `SELECT u.id, u.telegram_id::text AS telegram_id, u.name, u.username, u.started_at,
            m.admitted_at, u.private_reachable
     FROM users u
     JOIN forum_memberships m ON m.telegram_id = u.telegram_id AND m.forum_chat_id = $1::bigint
     WHERE m.is_member = true
       AND u.blocked_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM waitlist w WHERE w.user_id = u.id AND w.state = 'active')
     ORDER BY u.id`,
    [chatId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    telegramId: row.telegram_id,
    name: row.name,
    username: row.username,
    startedAt: row.started_at,
    admittedAt: row.admitted_at,
    privateReachable: row.private_reachable,
  }));
}

export async function countEligible(chatId: string): Promise<number> {
  const people = await listEligible(chatId);
  return people.length;
}

export async function distributionStarted(chatId: string, date: string): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM outbound_deliveries
     WHERE logical_key = $1 AND status IN ('pending', 'sending', 'sent', 'failed', 'uncertain')
     LIMIT 1`,
    [`topic-run:${chatId}:${date}`],
  );
  return (result.rowCount ?? result.rows.length) > 0;
}

export async function markDistributionStarted(chatId: string, date: string): Promise<void> {
  await enqueueDelivery({
    logicalKey: `topic-run:${chatId}:${date}`,
    operation: "topic_run",
    chatId,
    topicId: null,
    payload: { date },
  });
  await query(
    `UPDATE outbound_deliveries SET status = 'sent', updated_at = now()
     WHERE logical_key = $1 AND status = 'pending'`,
    [`topic-run:${chatId}:${date}`],
  );
}

export async function recentTopicIds(userId: number, beforeDate: string): Promise<number[]> {
  const result = await query<{ topic_id: number }>(
    `SELECT topic_id FROM days
     WHERE user_id = $1 AND topic_id IS NOT NULL AND date < $2::date
     ORDER BY date DESC
     LIMIT 7`,
    [userId, beforeDate],
  );
  return result.rows.map((row) => row.topic_id);
}

export async function listTopicOptions(): Promise<Array<{ id: number; text: string }>> {
  const result = await query<{ id: number; text: string }>(`SELECT id, text FROM topics ORDER BY id`);
  return result.rows;
}

export async function assignmentsForDate(chatId: string, date: string): Promise<Map<number, number>> {
  const result = await query<{ user_id: number; topic_id: number }>(
    `SELECT user_id, topic_id FROM days
     WHERE forum_chat_id = $1::bigint AND date = $2::date AND topic_id IS NOT NULL`,
    [chatId, date],
  );
  return new Map(result.rows.map((row) => [row.user_id, row.topic_id]));
}

export async function saveAssignment(userId: number, chatId: string, date: string, topicId: number): Promise<void> {
  await query(
    `INSERT INTO days (user_id, date, forum_chat_id, topic_id, assignment_at)
     VALUES ($1, $2::date, $3::bigint, $4, now())
     ON CONFLICT (user_id, date) DO UPDATE SET
       forum_chat_id = COALESCE(days.forum_chat_id, EXCLUDED.forum_chat_id),
       topic_id = COALESCE(days.topic_id, EXCLUDED.topic_id),
       assignment_at = COALESCE(days.assignment_at, EXCLUDED.assignment_at)`,
    [userId, date, chatId, topicId],
  );
}

export async function topicPage(limit: number, offset: number): Promise<{
  total: number;
  rows: Array<{ id: number; text: string; lastUsedOn: string | null }>;
}> {
  const result = await query<{ id: number; text: string; last_used_on: string | null; total: number }>(
    `SELECT id, text, to_char(last_used_on, 'YYYY-MM-DD') AS last_used_on, count(*) OVER()::int AS total
     FROM topics
     ORDER BY id DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  const total = result.rows[0]?.total ?? 0;
  return {
    total,
    rows: result.rows.map((row) => ({ id: row.id, text: row.text, lastUsedOn: row.last_used_on })),
  };
}

export async function getTopic(id: number): Promise<{ id: number; text: string } | null> {
  const result = await query<{ id: number; text: string }>(`SELECT id, text FROM topics WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export type PlanTask = ParsedTask & { id: number; position: number; completed: boolean };

export async function getPlan(userId: number, date: string): Promise<{
  id: number;
  dayId: number;
  state: string;
  revision: number;
  original: string;
  note: string | null;
  privateMessageId: number | null;
  privateChatId: string | null;
  forumMessageId: number | null;
  forumChatId: string | null;
  forumTopicId: number | null;
  tasks: PlanTask[];
} | null> {
  const result = await query<{
    id: number;
    day_id: number;
    state: string;
    revision: number;
    original_input: string;
    note: string | null;
    private_message_id: string | null;
    private_chat_id: string | null;
    forum_message_id: string | null;
    forum_chat_id: string | null;
    forum_topic_id: string | null;
  }>(
    `SELECT p.id, p.day_id, p.state, p.revision, p.original_input, p.note,
            p.private_message_id::text AS private_message_id,
            p.private_chat_id::text AS private_chat_id,
            p.forum_message_id::text AS forum_message_id,
            p.forum_chat_id::text AS forum_chat_id,
            p.forum_topic_id::text AS forum_topic_id
     FROM daily_plans p
     JOIN days d ON d.id = p.day_id
     WHERE d.user_id = $1 AND d.date = $2::date`,
    [userId, date],
  );
  const plan = result.rows[0];
  if (!plan) return null;
  const tasks = await query<{
    id: number;
    position: number;
    title: string;
    start_time: string | null;
    end_time: string | null;
    completed: boolean;
  }>(
    `SELECT id, position, title, start_time, end_time, completed
     FROM daily_tasks WHERE plan_id = $1 ORDER BY position, id`,
    [plan.id],
  );
  return {
    id: plan.id,
    dayId: plan.day_id,
    state: plan.state,
    revision: plan.revision,
    original: plan.original_input,
    note: plan.note,
    privateMessageId: plan.private_message_id == null ? null : Number(plan.private_message_id),
    privateChatId: plan.private_chat_id,
    forumMessageId: plan.forum_message_id == null ? null : Number(plan.forum_message_id),
    forumChatId: plan.forum_chat_id,
    forumTopicId: plan.forum_topic_id == null ? null : Number(plan.forum_topic_id),
    tasks: tasks.rows.map((task) => ({
      id: task.id,
      position: task.position,
      title: task.title,
      start: task.start_time,
      end: task.end_time,
      completed: task.completed,
    })),
  };
}

export async function createDraftPlan(userId: number, chatId: string, date: string, original: string, tasks: ParsedTask[]): Promise<number> {
  await query(
    `INSERT INTO days (user_id, date, forum_chat_id) VALUES ($1, $2::date, $3::bigint)
     ON CONFLICT (user_id, date) DO UPDATE SET forum_chat_id = COALESCE(days.forum_chat_id, EXCLUDED.forum_chat_id)`,
    [userId, date, chatId],
  );
  const day = await query<{ id: number }>(
    `SELECT id FROM days WHERE user_id = $1 AND date = $2::date`,
    [userId, date],
  );
  const dayId = day.rows[0]?.id;
  if (!dayId) throw new Error("day missing");
  const existing = await query<{ id: number; state: string }>(
    `SELECT id, state FROM daily_plans WHERE day_id = $1`,
    [dayId],
  );
  if (existing.rows[0]?.state === "published") throw new Error("plan already published");
  let planId = existing.rows[0]?.id;
  if (!planId) {
    const inserted = await query<{ id: number }>(
      `INSERT INTO daily_plans (day_id, state, original_input) VALUES ($1, 'draft', $2) RETURNING id`,
      [dayId, original],
    );
    planId = inserted.rows[0]?.id;
  } else {
    await query(
      `UPDATE daily_plans SET original_input = $2, revision = revision + 1 WHERE id = $1 AND state = 'draft'`,
      [planId, original],
    );
    await query(`DELETE FROM daily_tasks WHERE plan_id = $1`, [planId]);
  }
  if (!planId) throw new Error("plan missing");
  await insertTasks(planId, tasks);
  return planId;
}

export async function replacePlanTasks(
  userId: number,
  chatId: string,
  date: string,
  original: string,
  tasks: ParsedTask[],
): Promise<{ planId: number; revision: number; state: string }> {
  const planId = await createDraftPlan(userId, chatId, date, original, tasks).catch(async (err: unknown) => {
    if (!(err instanceof Error) || !err.message.includes("already published")) throw err;
    return rewritePublishedPlan(userId, date, original, tasks);
  });
  const saved = await getPlan(userId, date);
  if (!saved || saved.id !== planId) throw new Error("plan missing");
  return { planId: saved.id, revision: saved.revision, state: saved.state };
}

async function rewritePublishedPlan(userId: number, date: string, original: string, tasks: ParsedTask[]): Promise<number> {
  const current = await getPlan(userId, date);
  if (!current || current.state !== "published") throw new Error("plan missing");
  const done = new Set(current.tasks.filter((task) => task.completed).map((task) => task.title));
  await query(`UPDATE daily_plans SET original_input = $2, revision = revision + 1 WHERE id = $1`, [current.id, original]);
  await query(`DELETE FROM daily_tasks WHERE plan_id = $1`, [current.id]);
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    if (!task) continue;
    const completed = done.has(task.title);
    await query(
      `INSERT INTO daily_tasks (plan_id, position, title, start_time, end_time, completed, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 THEN now() ELSE NULL END)`,
      [current.id, index, task.title, task.start, task.end, completed],
    );
  }
  return current.id;
}

async function insertTasks(planId: number, tasks: ParsedTask[]): Promise<void> {
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    if (!task) continue;
    await query(
      `INSERT INTO daily_tasks (plan_id, position, title, start_time, end_time, completed, completed_at)
       VALUES ($1, $2, $3, $4, $5, false, NULL)`,
      [planId, index, task.title, task.start, task.end],
    );
  }
}

export async function publishPlan(planId: number, userId: number, expectedRevision: number): Promise<boolean> {
  const result = await query(
    `UPDATE daily_plans p
     SET state = 'published', published_at = now(), revision = revision + 1
     FROM days d
     WHERE p.id = $1 AND p.day_id = d.id AND d.user_id = $2
       AND p.state = 'draft' AND p.revision = $3
       AND EXISTS (SELECT 1 FROM daily_tasks t WHERE t.plan_id = p.id)`,
    [planId, userId, expectedRevision],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function setTaskCompletion(
  taskId: number,
  actorId: number,
  completed: boolean,
  expectedRevision: number,
  date: string,
): Promise<"applied" | "refresh" | "forbidden"> {
  const current = await query<{ completed: boolean; revision: number; user_id: number; date: string }>(
    `SELECT t.completed, p.revision, d.user_id, to_char(d.date, 'YYYY-MM-DD') AS date
     FROM daily_tasks t
     JOIN daily_plans p ON p.id = t.plan_id
     JOIN days d ON d.id = p.day_id
     WHERE t.id = $1`,
    [taskId],
  );
  const row = current.rows[0];
  if (!row) return "forbidden";
  if (row.user_id !== actorId) return "forbidden";
  if (row.date !== date) return "refresh";
  if (row.revision !== expectedRevision || row.completed === completed) return "refresh";
  const updated = await query(
    `WITH task AS (
       UPDATE daily_tasks t
       SET completed = $4,
           completed_at = CASE WHEN $4 THEN now() ELSE NULL END
       FROM daily_plans p
       JOIN days d ON d.id = p.day_id
       WHERE t.id = $1 AND t.plan_id = p.id AND p.revision = $2 AND d.user_id = $3
         AND to_char(d.date, 'YYYY-MM-DD') = $5
       RETURNING t.plan_id
     )
     UPDATE daily_plans SET revision = revision + 1
     WHERE id IN (SELECT plan_id FROM task)`,
    [taskId, expectedRevision, actorId, completed, date],
  );
  return (updated.rowCount ?? 0) > 0 ? "applied" : "refresh";
}

export async function setPlanNote(planId: number, userId: number, note: string): Promise<boolean> {
  const result = await query(
    `UPDATE daily_plans p SET note = $3
     FROM days d
     WHERE p.id = $1 AND p.day_id = d.id AND d.user_id = $2 AND p.state = 'published'`,
    [planId, userId, note],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function rememberPlanMessage(
  planId: number,
  dest: "private" | "forum",
  chatId: string,
  messageId: number,
  topicId: number | null,
): Promise<void> {
  if (dest === "private") {
    await query(
      `UPDATE daily_plans SET private_chat_id = $2::bigint, private_message_id = $3 WHERE id = $1`,
      [planId, chatId, messageId],
    );
    return;
  }
  await query(
    `UPDATE daily_plans
     SET forum_chat_id = $2::bigint, forum_message_id = $3, forum_topic_id = $4
     WHERE id = $1`,
    [planId, chatId, messageId, topicId],
  );
}

export async function enqueueDelivery(input: {
  logicalKey: string;
  operation: string;
  subject?: string | null;
  chatId: string | null;
  topicId: number | null;
  payload: Record<string, unknown>;
  coalesce?: boolean;
}): Promise<void> {
  await query(
    `INSERT INTO outbound_deliveries
       (logical_key, operation, subject, destination_chat_id, destination_topic_id, status, payload, retry_at)
     VALUES ($1, $2, $3, $4::bigint, $5, 'pending', $6::jsonb, now())
     ON CONFLICT (logical_key) DO UPDATE SET
       payload = CASE
         WHEN $7::boolean OR outbound_deliveries.status IN ('failed', 'uncertain') THEN EXCLUDED.payload
         ELSE outbound_deliveries.payload
       END,
       status = CASE
         WHEN outbound_deliveries.status IN ('failed', 'uncertain') THEN 'pending'
         WHEN $7::boolean AND outbound_deliveries.status <> 'sending' THEN 'pending'
         ELSE outbound_deliveries.status
       END,
       attempts = CASE
         WHEN outbound_deliveries.status IN ('failed', 'uncertain') THEN 0
         ELSE outbound_deliveries.attempts
       END,
       retry_at = CASE
         WHEN outbound_deliveries.status IN ('failed', 'uncertain') THEN now()
         WHEN $7::boolean AND outbound_deliveries.status <> 'sending' THEN now()
         ELSE outbound_deliveries.retry_at
       END,
       subject = COALESCE(EXCLUDED.subject, outbound_deliveries.subject),
       updated_at = now()`,
    [
      input.logicalKey,
      input.operation,
      input.subject ?? null,
      input.chatId,
      input.topicId,
      JSON.stringify(input.payload),
      input.coalesce === true,
    ],
  );
}

export async function claimDueDelivery(): Promise<DeliveryRow | null> {
  const result = await query<{
    id: number;
    logical_key: string;
    operation: string;
    subject: string | null;
    destination_chat_id: string | null;
    destination_topic_id: string | null;
    status: string;
    attempts: number;
    payload: Record<string, unknown> | null;
  }>(
    `UPDATE outbound_deliveries
     SET status = 'sending', attempts = attempts + 1, updated_at = now()
     WHERE id = (
       SELECT id FROM outbound_deliveries
       WHERE status = 'pending' AND (retry_at IS NULL OR retry_at <= now())
       ORDER BY id
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING id, logical_key, operation, subject,
               destination_chat_id::text AS destination_chat_id,
               destination_topic_id::text AS destination_topic_id,
               status, attempts, payload`,
  );
  const row = result.rows[0];
  if (!row) return null;
  const topic = row.destination_topic_id == null ? null : Number(row.destination_topic_id);
  return {
    id: row.id,
    logicalKey: row.logical_key,
    operation: row.operation,
    subject: row.subject,
    chatId: row.destination_chat_id,
    topicId: topic != null && Number.isSafeInteger(topic) ? topic : null,
    status: row.status,
    attempts: row.attempts,
    payload: row.payload ?? {},
  };
}

export async function completeDelivery(id: number, messageId: number | null): Promise<void> {
  await query(
    `UPDATE outbound_deliveries
     SET status = 'sent', message_id = $2, last_error = NULL, updated_at = now()
     WHERE id = $1`,
    [id, messageId],
  );
}

export async function rescheduleDelivery(id: number, delayMs: number, error: string): Promise<void> {
  await query(
    `UPDATE outbound_deliveries
     SET status = 'pending', retry_at = now() + make_interval(secs => $2::int),
         last_error = $3, updated_at = now()
     WHERE id = $1`,
    [id, String(Math.max(1, Math.ceil(delayMs / 1000))), error.slice(0, 500)],
  );
}

export async function failDelivery(id: number, error: string, uncertain: boolean): Promise<void> {
  await query(
    `UPDATE outbound_deliveries
     SET status = $2, last_error = $3, updated_at = now()
     WHERE id = $1`,
    [id, uncertain ? "uncertain" : "failed", error.slice(0, 500)],
  );
}

export async function markSendingUncertain(): Promise<void> {
  await query(
    `UPDATE outbound_deliveries
     SET status = 'uncertain', last_error = 'interrupted while sending', updated_at = now()
     WHERE status = 'sending'`,
  );
}

export async function deliveryProblemCounts(): Promise<{ failed: number; uncertain: number }> {
  const result = await query<{ failed: number; uncertain: number }>(
    `SELECT
       count(*) FILTER (WHERE status = 'failed')::int AS failed,
       count(*) FILTER (WHERE status = 'uncertain')::int AS uncertain
     FROM outbound_deliveries`,
  );
  return result.rows[0] ?? { failed: 0, uncertain: 0 };
}

export async function hasPublishedPlan(userId: number, date: string): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM daily_plans p
     JOIN days d ON d.id = p.day_id
     WHERE d.user_id = $1 AND d.date = $2::date AND p.state = 'published'
     LIMIT 1`,
    [userId, date],
  );
  return result.rows.length > 0;
}

export async function daySnapshot(userId: number, date: string): Promise<{
  dayId: number;
  admittedAt: Date | null;
  wakeUpAt: Date | null;
  topicId: number | null;
  forumPostedAt: Date | null;
  replyAt: Date | null;
  explanation: string | null;
} | null> {
  const result = await query<{
    id: number;
    admitted_at: Date | null;
    wake_up_at: Date | null;
    topic_id: number | null;
    forum_posted_at: Date | null;
    reply_at: Date | null;
    explanation: string | null;
  }>(
    `SELECT d.id, m.admitted_at, d.wake_up_at, d.topic_id, d.forum_posted_at, d.reply_at, d.explanation
     FROM days d
     JOIN users u ON u.id = d.user_id
     LEFT JOIN forum_memberships m ON m.telegram_id = u.telegram_id AND m.forum_chat_id = d.forum_chat_id
     WHERE d.user_id = $1 AND d.date = $2::date`,
    [userId, date],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    dayId: row.id,
    admittedAt: row.admitted_at,
    wakeUpAt: row.wake_up_at,
    topicId: row.topic_id,
    forumPostedAt: row.forum_posted_at,
    replyAt: row.reply_at,
    explanation: row.explanation,
  };
}

export async function ensureObligationDay(userId: number, chatId: string, date: string): Promise<number> {
  await query(
    `INSERT INTO days (user_id, date, forum_chat_id) VALUES ($1, $2::date, $3::bigint)
     ON CONFLICT (user_id, date) DO UPDATE SET forum_chat_id = COALESCE(days.forum_chat_id, EXCLUDED.forum_chat_id)`,
    [userId, date, chatId],
  );
  const result = await query<{ id: number }>(
    `SELECT id FROM days WHERE user_id = $1 AND date = $2::date`,
    [userId, date],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("day missing");
  return id;
}

export async function insertCase(input: {
  dayId: number;
  userId: number;
  requirement: "wake" | "plan" | "topic_response";
  deadline: Date;
  graceExpires: Date;
  remindedAt: Date | null;
  snapshot: Record<string, unknown>;
}): Promise<void> {
  await query(
    `INSERT INTO accountability_cases
       (day_id, user_id, requirement, deadline_at, reminded_at, grace_expires_at, state, snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, 'open', $7::jsonb)
     ON CONFLICT (day_id, requirement) DO NOTHING`,
    [
      input.dayId,
      input.userId,
      input.requirement,
      input.deadline,
      input.remindedAt,
      input.graceExpires,
      JSON.stringify(input.snapshot),
    ],
  );
}

export async function resolveCaseByRequirement(userId: number, date: string, requirement: string, late: boolean): Promise<void> {
  await query(
    `UPDATE accountability_cases c
     SET state = 'resolved', late = $4, resolved_at = now()
     FROM days d
     WHERE c.day_id = d.id AND d.user_id = $1 AND d.date = $2::date
       AND c.requirement = $3 AND c.state = 'open'`,
    [userId, date, requirement, late],
  );
}

export async function listActionableCases(chatId: string, limit: number, offset: number): Promise<
  Array<{ id: number; name: string; requirement: string; deadline: Date; explanation: string | null }>
> {
  const result = await query<{
    id: number;
    name: string;
    requirement: string;
    deadline_at: Date;
    explanation: string | null;
  }>(
    `SELECT c.id, u.name, c.requirement, c.deadline_at, d.explanation
     FROM accountability_cases c
     JOIN days d ON d.id = c.day_id
     JOIN users u ON u.id = c.user_id
     WHERE d.forum_chat_id = $1::bigint
       AND c.state = 'open'
       AND c.grace_expires_at <= now()
     ORDER BY c.grace_expires_at, c.id
     LIMIT $2 OFFSET $3`,
    [chatId, limit, offset],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    requirement: row.requirement,
    deadline: row.deadline_at,
    explanation: row.explanation,
  }));
}

export async function countActionableCases(chatId: string): Promise<number> {
  const result = await query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM accountability_cases c
     JOIN days d ON d.id = c.day_id
     WHERE d.forum_chat_id = $1::bigint AND c.state = 'open' AND c.grace_expires_at <= now()`,
    [chatId],
  );
  return result.rows[0]?.count ?? 0;
}

export async function getCase(caseId: number): Promise<{
  id: number;
  userId: number;
  telegramId: string;
  name: string;
  requirement: string;
  state: string;
  explanation: string | null;
  deadline: Date;
} | null> {
  const result = await query<{
    id: number;
    user_id: number;
    telegram_id: string;
    name: string;
    requirement: string;
    state: string;
    explanation: string | null;
    deadline_at: Date;
  }>(
    `SELECT c.id, c.user_id, u.telegram_id::text AS telegram_id, u.name, c.requirement, c.state,
            d.explanation, c.deadline_at
     FROM accountability_cases c
     JOIN days d ON d.id = c.day_id
     JOIN users u ON u.id = c.user_id
     WHERE c.id = $1`,
    [caseId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    telegramId: row.telegram_id,
    name: row.name,
    requirement: row.requirement,
    state: row.state,
    explanation: row.explanation,
    deadline: row.deadline_at,
  };
}

export async function saveJudgment(input: {
  caseId: number;
  adminTelegramId: string;
  body: string;
  kind: "excuse" | "exercise";
  chatId: string | null;
  topicId: number | null;
  messageId: number | null;
}): Promise<number> {
  const state = input.kind === "excuse" ? "excused" : "judged";
  await query(
    `UPDATE accountability_cases SET state = $2, resolved_at = CASE WHEN $2 = 'excused' THEN now() ELSE resolved_at END
     WHERE id = $1 AND state = 'open'`,
    [input.caseId, state],
  );
  const result = await query<{ id: number }>(
    `INSERT INTO judgments (case_id, admin_telegram_id, body, kind, forum_chat_id, forum_topic_id, forum_message_id, resolution)
     VALUES ($1, $2::bigint, $3, $4, $5::bigint, $6, $7, $8)
     ON CONFLICT (case_id) DO UPDATE SET
       body = EXCLUDED.body,
       kind = EXCLUDED.kind,
       forum_message_id = COALESCE(EXCLUDED.forum_message_id, judgments.forum_message_id)
     RETURNING id`,
    [
      input.caseId,
      input.adminTelegramId,
      input.body,
      input.kind,
      input.chatId,
      input.topicId,
      input.messageId,
      input.kind === "excuse" ? "resolved" : "pending",
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("judgment missing");
  return id;
}

export async function findJudgmentByMessage(chatId: string, messageId: number): Promise<{
  id: number;
  caseId: number;
  userId: number;
  telegramId: string;
} | null> {
  const result = await query<{ id: number; case_id: number; user_id: number; telegram_id: string }>(
    `SELECT j.id, j.case_id, c.user_id, u.telegram_id::text AS telegram_id
     FROM judgments j
     JOIN accountability_cases c ON c.id = j.case_id
     JOIN users u ON u.id = c.user_id
     WHERE j.forum_chat_id = $1::bigint AND j.forum_message_id = $2 AND j.kind = 'exercise'`,
    [chatId, messageId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, caseId: row.case_id, userId: row.user_id, telegramId: row.telegram_id };
}

export async function saveEvidence(judgmentId: number, actorTelegramId: string, evidence: {
  text?: string | null;
  fileId?: string | null;
  kind?: ReplyKind | null;
}): Promise<boolean> {
  const result = await query(
    `UPDATE judgments j
     SET evidence_text = $2, evidence_file_id = $3, evidence_kind = $4, evidence_at = now(), evidence_by = $5::bigint
     FROM accountability_cases c
     JOIN users u ON u.id = c.user_id
     WHERE j.id = $1 AND j.case_id = c.id AND u.telegram_id = $5::bigint AND j.resolution = 'pending'`,
    [judgmentId, evidence.text ?? null, evidence.fileId ?? null, evidence.kind ?? null, actorTelegramId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function resolveJudgment(caseId: number, adminTelegramId: string): Promise<boolean> {
  const result = await query(
    `UPDATE judgments SET resolution = 'resolved', resolved_at = now()
     WHERE case_id = $1 AND resolution = 'pending' AND EXISTS (
       SELECT 1 FROM accountability_cases c WHERE c.id = $1
     )`,
    [caseId],
  );
  if ((result.rowCount ?? 0) === 0) return false;
  await query(
    `UPDATE accountability_cases SET state = 'judged', resolved_at = COALESCE(resolved_at, now()) WHERE id = $1`,
    [caseId],
  );
  void adminTelegramId;
  return true;
}

export async function createAnnouncementDraft(adminTelegramId: string, body: string, userIds: number[]): Promise<number> {
  const created = await query<{ id: number }>(
    `INSERT INTO waitlist_announcements (body, admin_telegram_id, recipient_count)
     VALUES ($1, $2::bigint, $3)
     RETURNING id`,
    [body, adminTelegramId, userIds.length],
  );
  const id = created.rows[0]?.id;
  if (!id) throw new Error("announcement missing");
  for (const userId of userIds) {
    await query(
      `INSERT INTO waitlist_announcement_deliveries (announcement_id, user_id, status)
       VALUES ($1, $2, 'snapshot')
       ON CONFLICT (announcement_id, user_id) DO NOTHING`,
      [id, userId],
    );
  }
  return id;
}

export async function confirmAnnouncement(id: number, adminTelegramId: string): Promise<boolean> {
  const result = await query(
    `UPDATE waitlist_announcements
     SET confirmed_at = now()
     WHERE id = $1 AND admin_telegram_id = $2::bigint AND confirmed_at IS NULL AND cancelled_at IS NULL`,
    [id, adminTelegramId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function announcementAudience(id: number): Promise<Array<{ userId: number; telegramId: string }>> {
  const result = await query<{ user_id: number; telegram_id: string }>(
    `SELECT d.user_id, u.telegram_id::text AS telegram_id
     FROM waitlist_announcement_deliveries d
     JOIN users u ON u.id = d.user_id
     WHERE d.announcement_id = $1 AND d.status = 'snapshot'`,
    [id],
  );
  return result.rows.map((row) => ({ userId: row.user_id, telegramId: row.telegram_id }));
}

export async function markAnnouncementDelivery(announcementId: number, userId: number, status: "sent" | "failed", error: string | null): Promise<void> {
  await query(
    `UPDATE waitlist_announcement_deliveries
     SET status = $3, error = $4
     WHERE announcement_id = $1 AND user_id = $2`,
    [announcementId, userId, status, error],
  );
}

export async function activeWaitlistUserIds(chatId: string): Promise<number[]> {
  const result = await query<{ user_id: number }>(
    `SELECT user_id FROM waitlist WHERE forum_chat_id = $1::bigint AND state = 'active' ORDER BY joined_at, id`,
    [chatId],
  );
  return result.rows.map((row) => row.user_id);
}

export async function getAnnouncement(id: number): Promise<{ id: number; body: string; count: number; confirmedAt: Date | null } | null> {
  const result = await query<{ id: number; body: string; recipient_count: number; confirmed_at: Date | null }>(
    `SELECT id, body, recipient_count, confirmed_at FROM waitlist_announcements WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, body: row.body, count: row.recipient_count, confirmedAt: row.confirmed_at };
}

export async function markForumPosted(userId: number, date: string): Promise<void> {
  await query(
    `UPDATE days SET forum_delivery_status = 'published', forum_posted_at = COALESCE(forum_posted_at, now())
     WHERE user_id = $1 AND date = $2::date`,
    [userId, date],
  );
}

export async function markForumDelivery(userId: number, date: string, status: "pending" | "failed" | "uncertain"): Promise<void> {
  await query(
    `UPDATE days SET forum_delivery_status = $3 WHERE user_id = $1 AND date = $2::date`,
    [userId, date, status],
  );
}

export async function markPrivateDelivery(userId: number, date: string, status: "sent" | "failed" | "skipped" | "uncertain"): Promise<void> {
  await query(
    `UPDATE days
     SET private_delivery_status = $3,
         topic_sent_at = CASE WHEN $3 = 'sent' THEN COALESCE(topic_sent_at, now()) ELSE topic_sent_at END
     WHERE user_id = $1 AND date = $2::date`,
    [userId, date, status],
  );
}

export async function listAssignmentCards(chatId: string, date: string): Promise<
  Array<{
    userId: number;
    telegramId: string;
    name: string;
    username: string | null;
    startedAt: Date | null;
    topicId: number;
    topicText: string;
    forumStatus: string | null;
    privateStatus: string | null;
  }>
> {
  const result = await query<{
    user_id: number;
    telegram_id: string;
    name: string;
    username: string | null;
    started_at: Date | null;
    topic_id: number;
    text: string;
    forum_delivery_status: string | null;
    private_delivery_status: string | null;
  }>(
    `SELECT d.user_id, u.telegram_id::text AS telegram_id, u.name, u.username, u.started_at,
            d.topic_id, t.text, d.forum_delivery_status, d.private_delivery_status
     FROM days d
     JOIN users u ON u.id = d.user_id
     JOIN topics t ON t.id = d.topic_id
     WHERE d.forum_chat_id = $1::bigint AND d.date = $2::date AND d.topic_id IS NOT NULL
     ORDER BY u.id`,
    [chatId, date],
  );
  return result.rows.map((row) => ({
    userId: row.user_id,
    telegramId: row.telegram_id,
    name: row.name,
    username: row.username,
    startedAt: row.started_at,
    topicId: row.topic_id,
    topicText: row.text,
    forumStatus: row.forum_delivery_status,
    privateStatus: row.private_delivery_status,
  }));
}
