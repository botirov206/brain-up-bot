import assert from "node:assert/strict";
import test from "node:test";

process.env.BOT_TOKEN = "123456:TEST";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.BOT_USERNAME = "BrainUpTestBot";
process.env.ADMIN_TELEGRAM_IDS = "42";
process.env.DOTENV_CONFIG_PATH = "./missing-test-env";

const { pool } = await import("../dist/db.js");
const { handleStart } = await import("../dist/handlers/start.js");
const { beginFeedback } = await import("../dist/handlers/feedback.js");
const { captureGroupExplanation } = await import("../dist/handlers/explain.js");

const outsider = {
  id: 7,
  telegram_id: "7",
  name: "Out",
  username: null,
  role: "member",
  pending: null,
  started_at: new Date(),
  blocked_at: null,
  created_at: new Date(),
};

async function withQuery(fake, run) {
  const original = pool.query;
  pool.query = async (sql, params) => ({ rows: await fake(String(sql), params) });
  try {
    await run();
  } finally {
    pool.query = original;
  }
}

test("a verified non-member is offered the waitlist and writes no day", async () => {
  const sqls = [];
  await withQuery(async (sql) => {
    sqls.push(sql);
    if (sql.includes("INSERT INTO days")) throw new Error("outsider wrote a day");
    if (sql.includes("FROM users WHERE telegram_id")) return [];
    if (sql.startsWith("INSERT INTO users")) return [outsider];
    if (sql.startsWith("INSERT INTO settings") || sql.startsWith("INSERT INTO forum_memberships")) return [];
    if (sql.includes("SELECT group_chat_id")) return [{ group_chat_id: "-1001" }];
    return [];
  }, async () => {
    const replies = [];
    const ctx = {
      chat: { id: 7, type: "private" },
      from: { id: 7, first_name: "Out" },
      api: {},
      reply: async (body, options) => { replies.push({ body, options }); },
    };
    const bot = { api: { getChatMember: async () => ({ status: "left" }) } };
    await handleStart(ctx, bot, "");
    assert.match(replies.map((item) => item.body).join("\n"), /Hozirgi challenge davom etmoqda/);
    assert.equal(sqls.some((sql) => sql.includes("INSERT INTO days")), false);
  });
});

test("a former member cannot keep participating after leaving", async () => {
  await withQuery(async (sql) => {
    if (sql.includes("INSERT INTO days")) throw new Error("former member wrote a day");
    if (sql.includes("FROM users WHERE telegram_id")) return [outsider];
    if (sql.startsWith("INSERT INTO users") || sql.startsWith("UPDATE users SET name")) return [outsider];
    if (sql.startsWith("INSERT INTO settings") || sql.startsWith("INSERT INTO forum_memberships") || sql.startsWith("UPDATE waitlist")) return [];
    if (sql.includes("SELECT group_chat_id")) return [{ group_chat_id: "-1001" }];
    return [];
  }, async () => {
    const replies = [];
    const ctx = {
      chat: { id: 7, type: "private" },
      from: { id: 7, first_name: "Out" },
      api: {},
      reply: async (body) => { replies.push(body); },
    };
    const bot = { api: { getChatMember: async () => ({ status: "kicked" }) } };
    await handleStart(ctx, bot, "");
    assert.match(replies.join("\n"), /kutish ro‘yxatiga yozilishingiz mumkin/);
  });
});

test("feedback from an unrelated group is ignored", async () => {
  const sqls = [];
  await withQuery(async (sql) => {
    sqls.push(sql);
    if (sql.startsWith("INSERT INTO settings")) return [];
    if (sql.includes("SELECT group_chat_id")) return [{ group_chat_id: "-1001" }];
    if (sql.includes("INSERT INTO users") || sql.includes("INSERT INTO feedback")) throw new Error("unrelated group wrote a row");
    return [];
  }, async () => {
    const replies = [];
    const ctx = {
      chat: { id: -1009, type: "supergroup" },
      from: { id: 7, first_name: "Out" },
      reply: async (body) => { replies.push(body); },
    };
    await beginFeedback(ctx, "hello from elsewhere");
    assert.equal(replies.length, 0);
    assert.equal(sqls.some((sql) => sql.includes("INSERT INTO feedback")), false);
  });
});

test("an explanation reply in the wrong chat is ignored", async () => {
  const sqls = [];
  await withQuery(async (sql) => {
    sqls.push(sql);
    if (sql.includes("FROM day_posts")) {
      return [{ date: "2026-09-30", kind: "explain", message_id: "5", chat_id: "-1001", topic_id: "257", part_index: 0 }];
    }
    if (sql.includes("explanation")) throw new Error("wrong chat saved an explanation");
    return [];
  }, async () => {
    const ctx = {
      chat: { id: -1002, type: "supergroup" },
      from: { id: 7, first_name: "Out" },
      message: { text: "kech qoldim", reply_to_message: { message_id: 5 }, message_thread_id: 257 },
      reply: async () => { throw new Error("wrong chat was answered"); },
    };
    const handled = await captureGroupExplanation(ctx);
    assert.equal(handled, false);
    assert.equal(sqls.some((sql) => sql.toLowerCase().includes("explanation")), false);
  });
});
