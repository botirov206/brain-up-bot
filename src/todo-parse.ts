import { parseHHmm } from "./time.js";

export type ParsedTask = {
  title: string;
  start: string | null;
  end: string | null;
};

export type ParseResult =
  | { ok: true; tasks: ParsedTask[]; original: string }
  | { ok: false; error: string };

const GREETING =
  /^(salom|assalomu alaykum|assalomu aleykum|xayrli tong|hayrli tong|hello|hi|good morning)[.!?]*$/i;
const HEADING = /^(todo|to-do|reja|bugungi reja|kunlik reja|ro['’ʻ]yxat)[:\s.-]*$/i;
const TIME_PART = "(\\d{1,2}):(\\d{2})";
const LEADING_RANGE = new RegExp(`^${TIME_PART}\\s*[-–—]\\s*${TIME_PART}\\s*(?:\\||[-–—])?\\s*(.*)$`);
const LEADING_ONE = new RegExp(`^${TIME_PART}\\s*(?:\\||[-–—])\\s*(.*)$`);
const LEADING_ONE_LOOSE = new RegExp(`^${TIME_PART}\\s+(.+)$`);
const TRAILING_RANGE = new RegExp(`^(.*?)(?:\\s|\\|)\\s*${TIME_PART}\\s*[-–—]\\s*${TIME_PART}\\s*$`);
const TRAILING_ONE = new RegExp(`^(.*?)(?:\\s|\\|)\\s*${TIME_PART}\\s*$`);
const SPOKEN_TIME = "(?:\\d{1,2}:\\d{2}|\\d{1,2}\\s+yarim|\\d{1,2})";
const SPOKEN_RANGE = new RegExp(`^(${SPOKEN_TIME})\\s+dan\\s+(${SPOKEN_TIME})\\s+gacha\\s*(.*)$`, "i");
const SPOKEN_ONE = new RegExp(`^(${SPOKEN_TIME})\\s+da\\s+(.+)$`, "i");

export function parseTodoList(input: string): ParseResult {
  const original = input.replace(/\r\n/g, "\n").trim();
  if (!original) return { ok: false, error: "Ro‘yxat bo‘sh. Har bir vazifani alohida qatorga yozing." };

  const tasks: ParsedTask[] = [];
  for (const rawLine of original.split("\n")) {
    let line = rawLine.trim();
    if (!line) continue;
    if (GREETING.test(line) || HEADING.test(line) || /^bajarildi\s*:/i.test(line)) continue;
    if (/^📋/.test(line) && /\d{2}\.\d{2}\.\d{4}/.test(line)) continue;
    line = line.replace(/^(?:[-*•▪▫◦]+|\d+[.)])\s+/, "").replace(/^[☐✅]\s*/, "").trim();
    if (!line || GREETING.test(line) || HEADING.test(line)) continue;

    const timed = extractTimes(line);
    if (!timed.start) continue;
    const title = timed.title.replace(/\s+/g, " ").trim();
    if (!title) continue;
    if (title.length > 250) {
      return { ok: false, error: `Vazifa 250 belgidan oshmasligi kerak (${title.length}).` };
    }
    tasks.push({ title, start: timed.start, end: timed.end });
  }

  if (tasks.length === 0) {
    return { ok: false, error: "Soat yozilgan vazifa topilmadi. Har bir qatorga vaqt qo‘ying, masalan 09:00 | Kitob o‘qish." };
  }
  if (tasks.length > 40) return { ok: false, error: "Bir kunda ko‘pi bilan 40 ta vazifa bo‘lishi mumkin." };
  return { ok: true, tasks, original };
}

function extractTimes(line: string): { title: string; start: string | null; end: string | null } {
  const spoken = extractSpoken(line.replace(/yarimgacha/gi, "yarim gacha").replace(/yarimdan/gi, "yarim dan"));
  if (spoken) return spoken;
  const range = LEADING_RANGE.exec(line);
  if (range) {
    const start = clock(range[1], range[2]);
    const end = clock(range[3], range[4]);
    if (start && end) return { title: range[5] ?? "", start, end };
  }
  const leading = LEADING_ONE.exec(line) ?? LEADING_ONE_LOOSE.exec(line);
  if (leading) {
    const start = clock(leading[1], leading[2]);
    if (start) return { title: leading[3] ?? "", start, end: null };
  }
  const trailingRange = TRAILING_RANGE.exec(line);
  if (trailingRange) {
    const start = clock(trailingRange[2], trailingRange[3]);
    const end = clock(trailingRange[4], trailingRange[5]);
    if (start && end) return { title: trailingRange[1] ?? "", start, end };
  }
  const trailing = TRAILING_ONE.exec(line);
  if (trailing) {
    const start = clock(trailing[2], trailing[3]);
    if (start) return { title: trailing[1] ?? "", start, end: null };
  }
  return { title: line, start: null, end: null };
}

function extractSpoken(line: string): { title: string; start: string | null; end: string | null } | null {
  const range = SPOKEN_RANGE.exec(line);
  if (range) {
    const start = spokenClock(range[1] ?? "");
    const end = spokenClock(range[2] ?? "");
    if (start && end) return { title: cleanTitle(range[3] ?? ""), start, end };
  }
  const one = SPOKEN_ONE.exec(line);
  if (one) {
    const start = spokenClock(one[1] ?? "");
    if (start) return { title: cleanTitle(one[2] ?? ""), start, end: null };
  }
  return null;
}

function spokenClock(token: string): string | null {
  const colon = /^(\d{1,2}):(\d{2})$/.exec(token);
  if (colon) return clock(colon[1], colon[2]);
  const half = /^(\d{1,2})\s+yarim$/i.exec(token);
  if (half) return clock(half[1], "30");
  const hour = /^(\d{1,2})$/.exec(token);
  if (hour) return clock(hour[1], "00");
  return null;
}

function cleanTitle(title: string): string {
  return title.replace(/[.]+$/, "").trim();
}

function clock(hour: string | undefined, minute: string | undefined): string | null {
  if (hour === undefined || minute === undefined) return null;
  return parseHHmm(`${hour}:${minute}`);
}

export function formatTaskLine(task: ParsedTask, done: boolean): string {
  const mark = done ? "✅" : "☐";
  const time =
    task.start && task.end ? `${task.start}–${task.end} | ` : task.start ? `${task.start} | ` : "";
  return `${mark} ${time}${task.title}`;
}
