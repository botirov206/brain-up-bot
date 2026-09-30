import { peopleFromRows, tallyPerson, wakeClass, type PersonFacts } from "./accountability.js";
import { config } from "./config.js";
import { escapeHtml, profileLink } from "./html.js";
import { listAccountRows, type Settings } from "./repo.js";
import { clipText } from "./texts.js";
import { formatTime, shiftDate, todayDateString } from "./time.js";

const WINDOW_DAYS = 7;

function who(person: PersonFacts): string {
  return profileLink(person.telegramId, person.name, person.username);
}

function windowDates(today: string): string[] {
  const dates: string[] = [];
  for (let ago = WINDOW_DAYS - 1; ago >= 0; ago -= 1) dates.push(shiftDate(today, -ago));
  return dates;
}

async function loadPeople(fromDate: string, toDate: string): Promise<PersonFacts[]> {
  const rows = await listAccountRows(fromDate, toDate);
  return peopleFromRows(rows, config.timezone);
}

export async function todayBoardText(settings: Settings, memberCount: number | null): Promise<string> {
  const today = todayDateString(config.timezone);
  const people = await loadPeople(today, today);
  const checkedIn = people.filter((person) => person.byDate.get(today)?.wakeUpAt).length;
  const topicSent = people.filter((person) => person.byDate.get(today)?.topicSent).length;
  const replied = people.filter((person) => person.byDate.get(today)?.replied).length;
  const lines = [
    "📅 Today's progress",
    coverageLine(people.length, memberCount),
    `🌅 Check-ins: ${checkedIn}/${people.length}`,
    topicSent ? `🎙 Topic replies: ${replied}/${topicSent}` : "🎙 Topic replies: waiting for today's topic",
    "",
  ];
  const topic = people.map((person) => person.byDate.get(today)?.topicText).find((text) => text);
  lines.push(topic ? `🧠 Topic\n${escapeHtml(clipText(topic, 240))}` : "🧠 Topic has not been sent yet.");
  if (people.length === 0) {
    lines.push("", "👋 Nobody has pressed Start. Ask members to open the bot once so it can track them.");
    return lines.join("\n");
  }
  lines.push("");
  for (const person of people.slice(0, 40)) {
    const day = person.byDate.get(today);
    const kind = wakeClass(config.timezone, day?.wakeUpAt ?? null, settings.on_time);
    const wake =
      day?.wakeCard === "yellow" && day.wakeUpAt
        ? `🟡 ${formatTime(config.timezone, day.wakeUpAt)}`
        : kind === "on_time" && day?.wakeUpAt
          ? `✅ ${formatTime(config.timezone, day.wakeUpAt)}`
          : kind === "late" && day?.wakeUpAt
            ? `🟠 ${formatTime(config.timezone, day.wakeUpAt)}`
            : "🔴 no check-in";
    const reply = !day?.topicSent ? "topic pending" : day.replied ? "🎙 replied" : "🎙 no reply";
    lines.push(`${who(person)}  ${wake}  ${reply}`);
    if (day?.explanation) lines.push(`  📝 ${escapeHtml(clipText(day.explanation, 160))}`);
  }
  if (people.length > 40) lines.push(`… and ${people.length - 40} more`);
  lines.push("", `📣 Send /report to post today's totals to the group. An automatic report runs at ${settings.report_time}.`);
  return lines.join("\n");
}

export async function standingBoardText(settings: Settings, memberCount: number | null): Promise<string> {
  const today = todayDateString(config.timezone);
  const now = formatTime(config.timezone, new Date());
  const dates = windowDates(today);
  const people = await loadPeople(dates[0] ?? today, today);
  const ranked = people.map((person) => ({
    person,
    tally: tallyPerson(person, dates, today, now, settings.on_time, settings.explain_time, config.timezone),
  }));
  const attention = ranked
    .filter((row) => row.tally.low)
    .sort((a, b) => b.tally.missed - a.tally.missed || b.tally.late - a.tally.late || a.person.name.localeCompare(b.person.name));
  const steady = ranked
    .filter((row) => !row.tally.low)
    .sort((a, b) => b.tally.onTime - a.tally.onTime || b.tally.replies - a.tally.replies);

  const lines = [`📈 Last ${WINDOW_DAYS} days`, coverageLine(people.length, memberCount)];
  lines.push("", attention.length ? "🟠 Needs attention" : "✅ Nobody needs attention right now.");
  for (const row of attention.slice(0, 30)) lines.push(standingLine(row.person, row.tally));
  if (steady.length > 0) {
    lines.push("", "────────", "", "✅ On track");
    for (const row of steady.slice(0, 30)) lines.push(standingLine(row.person, row.tally));
  }
  lines.push("", `ℹ️ ✅ on time · 🟠 late · 🔴 missed · 🟡 sababli · 🎙 replies/topics. On time means by ${settings.on_time}.`);
  return lines.join("\n");
}

function standingLine(person: PersonFacts, tally: { onTime: number; late: number; missed: number; excused: number; sent: number; replies: number }): string {
  return `${who(person)}  ✅ ${tally.onTime} · 🟠 ${tally.late} · 🔴 ${tally.missed} · 🟡 ${tally.excused} · 🎙 ${tally.replies}/${tally.sent}`;
}

function coverageLine(known: number, memberCount: number | null): string {
  if (memberCount === null) {
    return `👥 Tracking ${known} people who pressed Start. The bot cannot list every group member.`;
  }
  return `👥 About ${memberCount} group members; tracking ${known} who pressed Start.`;
}

export async function peopleToAsk(settings: Settings): Promise<PersonFacts[]> {
  const today = todayDateString(config.timezone);
  const people = await loadPeople(today, today);
  return people.filter((person) => {
    const day = person.byDate.get(today);
    if (day?.explanation) return false;
    const kind = wakeClass(config.timezone, day?.wakeUpAt ?? null, settings.on_time);
    return kind !== "on_time";
  });
}
