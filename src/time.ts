export function todayDateString(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("Could not format today's date");
  }
  return `${year}-${month}-${day}`;
}

/** Add calendar days to a YYYY-MM-DD string. */
export function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) throw new Error(`Invalid date: ${date}`);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function formatTime(timeZone: string, value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  if (hour === undefined || minute === undefined) {
    throw new Error("Could not format time");
  }
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

export function formatDateTime(timeZone: string, value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const day = parts.find((part) => part.type === "day")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  if (!day || !month || hour === undefined || minute === undefined) {
    return formatTime(timeZone, date);
  }
  return `${day}.${month} ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

/** Accept H:mm or HH:mm and return HH:mm, or null when invalid. */
export function parseHHmm(input: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
  if (!match) return null;
  const hourRaw = match[1];
  const minuteRaw = match[2];
  if (hourRaw === undefined || minuteRaw === undefined) return null;
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Cron expression (minute hour * * *) for an HH:mm wall time. */
export function hhmmToCron(hhmm: string): string {
  const parsed = parseHHmm(hhmm);
  if (!parsed) throw new Error(`Invalid HH:mm: ${hhmm}`);
  const [hour, minute] = parsed.split(":");
  if (hour === undefined || minute === undefined) throw new Error(`Invalid HH:mm: ${hhmm}`);
  return `${Number(minute)} ${Number(hour)} * * *`;
}

/** A dated deep link cannot check someone in on a later day or after noon. */
export function activeWakePayload(payload: string, timeZone: string, now = new Date()): boolean {
  return payload === `wake_${todayDateString(timeZone, now).replaceAll("-", "")}`
    && formatTime(timeZone, now) < "12:00";
}
