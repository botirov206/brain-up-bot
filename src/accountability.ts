import type { AccountRow } from "./repo.js";
import { formatTime, todayDateString } from "./time.js";

export type DayFact = {
  wakeUpAt: Date | null;
  topicSent: boolean;
  replied: boolean;
  topicText: string | null;
  explanation: string | null;
};

export type PersonFacts = {
  telegramId: string;
  name: string;
  username: string | null;
  startedOn: string;
  byDate: Map<string, DayFact>;
};

export type Tally = {
  onTime: number;
  late: number;
  missed: number;
  sent: number;
  replies: number;
  low: boolean;
};

export function peopleFromRows(rows: AccountRow[], timeZone: string): PersonFacts[] {
  const map = new Map<string, PersonFacts>();
  for (const row of rows) {
    let person = map.get(row.telegramId);
    if (!person) {
      person = {
        telegramId: row.telegramId,
        name: row.name,
        username: row.username,
        startedOn: todayDateString(timeZone, row.startedAt),
        byDate: new Map(),
      };
      map.set(row.telegramId, person);
    }
    if (!row.date) continue;
    person.byDate.set(row.date, {
      wakeUpAt: row.wakeUpAt,
      topicSent: row.topicSentAt !== null,
      replied: row.replyAt !== null,
      topicText: row.topicText,
      explanation: row.explanation,
    });
  }
  return [...map.values()];
}

export function wakeClass(timeZone: string, wakeUpAt: Date | null, onTime: string): "none" | "on_time" | "late" {
  if (!wakeUpAt) return "none";
  return formatTime(timeZone, wakeUpAt) > onTime ? "late" : "on_time";
}

/** A missed day is closed once that calendar day is over, or once today's ask-why time has passed. */
export function tallyPerson(
  person: PersonFacts,
  dates: string[],
  today: string,
  nowHHmm: string,
  onTime: string,
  explainTime: string,
  timeZone: string,
): Tally {
  let onTimeCount = 0;
  let late = 0;
  let missed = 0;
  let sent = 0;
  let replies = 0;
  for (const date of dates) {
    if (date < person.startedOn) continue;
    const day = person.byDate.get(date);
    if (day?.topicSent) {
      sent += 1;
      if (day.replied) replies += 1;
    }
    const kind = wakeClass(timeZone, day?.wakeUpAt ?? null, onTime);
    if (kind === "on_time") onTimeCount += 1;
    else if (kind === "late") late += 1;
    else if (date < today || (date === today && nowHHmm >= explainTime)) missed += 1;
  }
  const low = missed > 0 || late > 0 || (sent > 0 && replies < sent);
  return { onTime: onTimeCount, late, missed, sent, replies, low };
}
