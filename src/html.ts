export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Tapping the label opens that person's Telegram profile. */
export function profileLink(telegramId: string, name: string, username: string | null): string {
  const handle = username?.replace(/^@/, "").trim();
  const label = handle ? `@${handle}` : name;
  const safe = escapeHtml(label);
  if (!/^\d+$/.test(telegramId)) return safe;
  return `<a href="tg://user?id=${telegramId}">${safe}</a>`;
}
