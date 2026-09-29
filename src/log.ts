import { config } from "./config.js";

export function logError(label: string, err: unknown): void {
  let text = err instanceof Error ? (err.stack ?? err.message) : String(err);
  for (const secret of [config.botToken, config.databaseUrl]) {
    if (secret) text = text.split(secret).join("[redacted]");
  }
  console.error(`[${label}]`, text);
}

export function errorText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text;
}
