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

function optionalGroupChatId(): string | null {
  const value = process.env.GROUP_CHAT_ID?.trim() ?? "";
  if (!value) return null;
  if (!/^-?\d+$/.test(value)) {
    console.error(
      "GROUP_CHAT_ID must be a numeric chat id (supergroups look like -100...). Leave it empty and set the group with /group.",
    );
    process.exit(1);
  }
  return value;
}

const groupChatId = optionalGroupChatId();

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

/** The configured id list is the only source of admin authority. */
export function isConfiguredAdmin(telegramId: string | number): boolean {
  return config.adminIds.includes(String(telegramId));
}
