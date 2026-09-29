import "dotenv/config";

function required(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) {
    console.error(`Missing required env: ${name}. Copy example.env to .env and fill it in.`);
    process.exit(1);
  }
  return value;
}

function parseAdminIds(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const ids: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!id) continue;
    if (!/^\d+$/.test(id)) {
      console.error(
        `ADMIN_TELEGRAM_IDS contains a non-numeric id (${id}). Use numeric ids from @userinfobot, comma-separated. No @usernames.`,
      );
      process.exit(1);
    }
    ids.push(id);
  }
  return ids;
}

const groupChatId = required("GROUP_CHAT_ID");
if (!/^-?\d+$/.test(groupChatId)) {
  console.error("GROUP_CHAT_ID must be a numeric chat id (supergroups look like -100...).");
  process.exit(1);
}

const botUsername = required("BOT_USERNAME").replace(/^@/, "");
if (!/^[A-Za-z0-9_]{5,32}$/.test(botUsername)) {
  console.error("BOT_USERNAME must be the bot username from BotFather, without @.");
  process.exit(1);
}

const timezone = process.env.TIMEZONE?.trim() || "Asia/Tashkent";
try {
  Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
} catch {
  console.error(`TIMEZONE is not a valid IANA timezone: ${timezone}`);
  process.exit(1);
}

export const config = {
  botToken: required("BOT_TOKEN"),
  databaseUrl: required("DATABASE_URL"),
  groupChatId,
  adminIds: parseAdminIds(process.env.ADMIN_TELEGRAM_IDS),
  botUsername,
  timezone,
};
