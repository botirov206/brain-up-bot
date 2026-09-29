import { createBot, registerCommandMenu } from "./bot.js";
import { config } from "./config.js";
import { migrate, pool } from "./db.js";
import { startScheduler, stopScheduler } from "./jobs.js";
import { logError } from "./log.js";

async function main(): Promise<void> {
  console.log(`Brain-Up bot starting (timezone ${config.timezone})`);
  await migrate();
  const bot = createBot();
  await registerCommandMenu(bot);
  await startScheduler(bot);

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    console.log(`Received ${signal}, stopping`);
    stopScheduler();
    void bot.stop();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  await bot.start({
    onStart: (info) => {
      console.log(`Long polling as @${info.username}`);
      if (info.username !== config.botUsername) {
        console.error(
          `BOT_USERNAME is ${config.botUsername} but Telegram says @${info.username}. The Uyg'ondim link will be wrong until .env matches.`,
        );
      }
    },
  });
  await pool.end();
}

main().catch((err: unknown) => {
  logError("fatal", err);
  process.exit(1);
});
