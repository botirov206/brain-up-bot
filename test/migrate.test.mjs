import test from "node:test";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("fresh and repeated migrations succeed on an isolated database", { skip: !databaseUrl }, async () => {
  if (!databaseUrl || /neon\.tech|production/i.test(databaseUrl)) {
    throw new Error("TEST_DATABASE_URL must be an isolated database, not a hosted production URL");
  }
  process.env.BOT_TOKEN = "123456:TEST";
  process.env.DATABASE_URL = databaseUrl;
  process.env.BOT_USERNAME = "BrainUpTestBot";
  process.env.ADMIN_TELEGRAM_IDS = "42";
  process.env.DOTENV_CONFIG_PATH = "./missing-test-env";
  const { migrate, pool } = await import("../dist/db.js");
  await migrate();
  await migrate();
  await pool.end();
});
