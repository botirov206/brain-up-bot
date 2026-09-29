import assert from "node:assert/strict";
import test from "node:test";

process.env.BOT_TOKEN = "123456:TEST";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.BOT_USERNAME = "BrainUpTestBot";
process.env.ADMIN_TELEGRAM_IDS = "42";
process.env.DOTENV_CONFIG_PATH = "./missing-test-env";

const { pool } = await import("../dist/db.js");
const { adminButtonAction, adminButtons, adminKeyboard } = await import("../dist/admin-ui.js");
const { handleAdminButton, handleAdminCommand } = await import("../dist/handlers/admin.js");
const { handleStart } = await import("../dist/handlers/start.js");
const { beginFeedback } = await import("../dist/handlers/feedback.js");
const { removeOldWakePosts, runTopicJob } = await import("../dist/jobs.js");

const settings = {
  wake_time: "05:30",
  on_time: "06:00",
  topic_time: "08:00",
  explain_time: "09:00",
  report_time: "21:00",
};
const user = {
  id: 1,
  telegram_id: "42",
  name: "Admin",
  username: null,
  role: "admin",
  pending: null,
  started_at: new Date(),
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

function context(text, type = "private") {
  const replies = [];
  return {
    chat: { id: type === "private" ? 42 : -1001, type },
    from: { id: 42, first_name: "Admin" },
    message: { text },
    api: { setMyCommands: async () => true },
    replies,
    reply: async (body, options) => { replies.push({ body, options }); },
  };
}

test("admin keyboard has six distinct actions; old Group and Report labels open their replacements", () => {
  const labels = adminKeyboard.keyboard.flat().map((button) => button.text);
  assert.equal(labels.length, 6);
  assert.equal(new Set(labels).size, 6);
  assert.equal(labels.includes("👥 Group"), false);
  assert.equal(labels.includes("📊 Report"), false);
  assert.equal(adminButtonAction("👥 Group"), adminButtons.settings);
  assert.equal(adminButtonAction("📊 Report"), adminButtons.today);
});

test("old Group button opens Schedule Settings with group guidance", async () => {
  await withQuery(async (sql) => {
    if (sql.startsWith("UPDATE users SET pending") || sql.startsWith("INSERT INTO settings")) return [];
    if (sql.includes("SELECT wake_time")) return [settings];
    if (sql.includes("SELECT group_chat_id")) return [{ group_chat_id: null }];
    throw new Error(`Unexpected SQL: ${sql}`);
  }, async () => {
    const ctx = context("👥 Group");
    assert.equal(await handleAdminButton(ctx, {}), true);
    assert.match(ctx.replies[0].body, /Schedule Settings/);
    assert.match(ctx.replies[0].body, /send \/group inside that group/);
    assert.equal(ctx.replies[0].options.reply_markup, adminKeyboard);
  });
});

test("old Report button opens today's progress without posting to the group", async () => {
  await withQuery(async (sql) => {
    if (sql.startsWith("UPDATE users SET pending") || sql.startsWith("INSERT INTO settings")) return [];
    if (sql.includes("SELECT wake_time")) return [settings];
    if (sql.includes("SELECT group_chat_id")) return [{ group_chat_id: null }];
    if (sql.includes("FROM users u") && sql.includes("LEFT JOIN days")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  }, async () => {
    const ctx = context("📊 Report");
    const bot = { api: { sendMessage: () => { throw new Error("unexpected post"); } } };
    assert.equal(await handleAdminButton(ctx, bot), true);
    assert.match(ctx.replies[0].body, /Today's progress/);
    assert.match(ctx.replies[0].body, /Check-ins: 0\/0/);
  });
});

test("admin report command in a group redirects to the private chat", async () => {
  const ctx = context("/report", "supergroup");
  await handleAdminCommand(ctx, { api: { sendMessage: () => { throw new Error("unexpected post"); } } }, "report", "");
  assert.match(ctx.replies[0].body, /privately/);
});

test("schedule rejects times that make the daily sequence impossible", async () => {
  const sqls = [];
  await withQuery(async (sql) => {
    sqls.push(sql);
    if (sql.startsWith("INSERT INTO settings")) return [];
    if (sql.includes("SELECT wake_time")) return [settings];
    throw new Error(`Unexpected SQL: ${sql}`);
  }, async () => {
    for (const [input, reason] of [
      ["ontime 13:00", /cannot be after 12:00/],
      ["wake 07:00", /before the on-time deadline/],
      ["explain 05:00", /after the on-time deadline/],
      ["topic 22:00", /after the topic is sent/],
    ]) {
      const ctx = context(`/settings ${input}`);
      await handleAdminCommand(ctx, {}, "settings", input);
      assert.match(ctx.replies[0].body, reason);
    }
    assert.equal(sqls.some((sql) => sql.startsWith("UPDATE settings")), false);
  });
});

test("/group inside a group still connects it after removing the Group button", async () => {
  await withQuery(async (sql) => {
    if (sql.startsWith("INSERT INTO settings") || sql.startsWith("UPDATE settings SET group_chat_id")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  }, async () => {
    const ctx = context("/group", "supergroup");
    const bot = { api: {
      getChat: async () => ({ id: -1001, type: "supergroup", title: "Brain-Up" }),
      getMe: async () => ({ id: 99 }),
      getChatMember: async () => ({ status: "administrator" }),
    } };
    await handleAdminCommand(ctx, bot, "group", "");
    assert.match(ctx.replies[0].body, /Connected to Brain-Up/);
  });
});

test("/report in private posts the daily totals once", async () => {
  await withQuery(async (sql) => {
    if (sql.startsWith("INSERT INTO settings")) return [];
    if (sql.includes("SELECT group_chat_id")) return [{ group_chat_id: "-1001" }];
    if (sql.includes("AS started") && sql.includes("AS wakes")) {
      assert.match(sql, /AS topic_sent/);
      return [{ started: 3, wakes: 2, topic_sent: 2, replies: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }, async () => {
    const posts = [];
    const bot = { api: {
      getChat: async () => ({ id: -1001, type: "supergroup", title: "Brain-Up" }),
      sendMessage: async (chat, body) => { posts.push({ chat, body }); },
    } };
    const ctx = context("/report");
    await handleAdminCommand(ctx, bot, "report", "");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].chat, "-1001");
    assert.match(posts[0].body, /Uyg'onganlar: 2\/3/);
    assert.match(posts[0].body, /Mavzuga javoblar: 1\/2/);
    assert.match(ctx.replies[0].body, /posted to the group/);
  });
});

test("legacy wake link cannot write a check-in", async () => {
  const sqls = [];
  await withQuery(async (sql) => {
    sqls.push(sql);
    if (sql.includes("FROM users WHERE telegram_id")) return [user];
    if (sql.startsWith("INSERT INTO users")) return [user];
    throw new Error(`Unexpected SQL: ${sql}`);
  }, async () => {
    const ctx = context("/start wake");
    await handleStart(ctx, {}, "wake");
    assert.match(ctx.replies[0].body, /eskirgan/);
    assert.equal(sqls.some((sql) => sql.includes("INSERT INTO days")), false);
  });
});

test("a first-time admin sees the new menu and its purpose", async () => {
  await withQuery(async (sql) => {
    if (sql.includes("FROM users WHERE telegram_id")) return [];
    if (sql.startsWith("INSERT INTO users")) return [user];
    throw new Error(`Unexpected SQL: ${sql}`);
  }, async () => {
    const ctx = context("/start");
    await handleStart(ctx, {}, "");
    assert.match(ctx.replies[0].body, /Today's progress shows check-ins and topic replies/);
    assert.equal(ctx.replies[0].options.reply_markup, adminKeyboard);
  });
});

test("wake cleanup deletes tracked posts and removes a button if deletion fails", async () => {
  const removed = [];
  await withQuery(async (sql, params) => {
    if (sql.includes("FROM day_posts WHERE kind = 'wake'")) return [
      { date: "2026-09-29", message_id: "10" },
      { date: "2026-09-30", message_id: "11" },
    ];
    if (sql.startsWith("INSERT INTO settings")) return [];
    if (sql.includes("SELECT group_chat_id")) return [{ group_chat_id: "-1001" }];
    if (sql.startsWith("DELETE FROM day_posts")) { removed.push(params[0]); return []; }
    throw new Error(`Unexpected SQL: ${sql}`);
  }, async () => {
    const edited = [];
    const bot = { api: {
      deleteMessage: async (_chat, id) => { if (id === 11) throw new Error("too old"); },
      editMessageReplyMarkup: async (_chat, id, options) => { edited.push({ id, options }); },
    } };
    await removeOldWakePosts(bot, "2026-09-30");
    assert.deepEqual(removed, ["2026-09-29", "2026-09-30"]);
    assert.deepEqual(edited, [{ id: 11, options: { reply_markup: { inline_keyboard: [] } } }]);
  });
});

test("topic job skips DMs when no group is connected", async () => {
  await withQuery(async (sql) => {
    if (sql.startsWith("INSERT INTO settings")) return [];
    if (sql.includes("SELECT group_chat_id")) return [{ group_chat_id: null }];
    throw new Error(`Unexpected SQL: ${sql}`);
  }, async () => {
    await runTopicJob({ api: { sendMessage: () => { throw new Error("unexpected DM"); } } });
  });
});

test("topic job skips DMs when the saved group is inaccessible", async () => {
  await withQuery(async (sql) => {
    if (sql.startsWith("INSERT INTO settings")) return [];
    if (sql.includes("SELECT group_chat_id")) return [{ group_chat_id: "-1001" }];
    throw new Error(`Unexpected SQL: ${sql}`);
  }, async () => {
    const bot = { api: {
      getChat: async () => { throw new Error("chat not found"); },
      sendMessage: () => { throw new Error("unexpected DM"); },
    } };
    await runTopicJob(bot);
  });
});

test("/feedback text in private chat saves the text without a second prompt", async () => {
  const sqls = [];
  await withQuery(async (sql) => {
    sqls.push(sql);
    if (sql.includes("FROM users WHERE telegram_id")) return [user];
    if (sql.startsWith("INSERT INTO feedback")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  }, async () => {
    const ctx = context("/feedback Use a timer");
    await beginFeedback(ctx, "Use a timer");
    assert.match(ctx.replies[0].body, /Rahmat/);
    assert.equal(sqls.some((sql) => sql.includes("SET pending")), false);
  });
});
