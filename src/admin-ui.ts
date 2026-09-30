import { Keyboard, type Api } from "grammy";
import { logError } from "./log.js";

const startCommand = { command: "start", description: "Botni boshlash" };

export const memberCommands = [
  startCommand,
  { command: "feedback", description: "Taklif yuborish" },
  { command: "admin", description: "Admin menyusi" },
];

export const adminCommands = [
  startCommand,
  { command: "settings", description: "⏰ View or change the daily schedule" },
  { command: "topics", description: "🧠 View or add discussion topics" },
  { command: "report", description: "📊 Post today's report to the group" },
];

export const adminButtons = {
  woke: "🌅 Check-ins",
  standing: "📈 7-day view",
  today: "📅 Today's progress",
  topics: "🧠 Topics",
  settings: "⏰ Schedule Settings",
  feedback: "💬 Member feedback",
  users: "👥 Users",
  accountability: "⚖️ Accountability",
  member: "👤 Ishtirokchi",
} as const;

export const memberButtons = {
  plan: "📋 Bugungi rejam",
  topic: "🧠 Bugungi mavzum",
  feedback: "💬 Taklif",
} as const;

const buttonLabels = new Set<string>(Object.values(adminButtons));

const legacyButtons = new Map<string, string>([
  ["Woke up", adminButtons.woke],
  ["Report", adminButtons.today],
  ["Standing", adminButtons.standing],
  ["Today", adminButtons.today],
  ["Topics", adminButtons.topics],
  ["Settings", adminButtons.settings],
  ["Feedback", adminButtons.feedback],
  ["💬 Feedback", adminButtons.feedback],
  ["Group", adminButtons.settings],
  ["📊 Report", adminButtons.today],
  ["📅 Today", adminButtons.today],
  ["⏰ Schedule", adminButtons.settings],
  ["👥 Group", adminButtons.settings],
  ["How many", adminButtons.woke],
  ["Who woke up", adminButtons.woke],
  ["Who didn't", adminButtons.woke],
  ["Recap", adminButtons.today],
]);

/** Current button label, or the same action for a label from the previous keyboard. */
export function adminButtonAction(text: string): string | null {
  if (buttonLabels.has(text)) return text;
  return legacyButtons.get(text) ?? null;
}

export const adminKeyboard = new Keyboard()
  .text(adminButtons.woke)
  .text(adminButtons.today)
  .row()
  .text(adminButtons.standing)
  .text(adminButtons.topics)
  .row()
  .text(adminButtons.settings)
  .text(adminButtons.feedback)
  .row()
  .text(adminButtons.users)
  .text(adminButtons.accountability)
  .row()
  .text(adminButtons.member)
  .resized()
  .persistent();

export const memberKeyboard = new Keyboard()
  .text(memberButtons.plan)
  .row()
  .text(memberButtons.topic)
  .row()
  .text(memberButtons.feedback)
  .resized()
  .persistent();

export function memberMarkup(_role: string) {
  return { reply_markup: memberKeyboard };
}

const menuReady = new Set<number>();

export async function ensureMemberMenu(api: Api, userId: number): Promise<void> {
  menuReady.delete(userId);
  try {
    await api.setMyCommands(memberCommands, { scope: { type: "chat", chat_id: userId } });
  } catch (err) {
    logError(`setMyCommands member ${userId}`, err);
  }
}

/** Chat-scoped commands replace the default menu, which only lists /start. */
export async function ensureAdminMenu(api: Api, userId: number): Promise<void> {
  if (menuReady.has(userId)) return;
  try {
    await api.setMyCommands(adminCommands, {
      scope: { type: "chat", chat_id: userId },
    });
    menuReady.add(userId);
  } catch (err) {
    logError(`setMyCommands admin ${userId}`, err);
  }
}
