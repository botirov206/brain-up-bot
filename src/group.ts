import type { Bot } from "grammy";
import { config } from "./config.js";
import { groupIdCandidates } from "./group-id.js";
import { errorText, logError } from "./log.js";
import { getGroupChatId, setGroupChatId } from "./repo.js";

export type GroupLookup =
  | { ok: true; id: string; title: string }
  | { ok: false; reason: "notfound" | "notgroup" };

/** Find a group chat, adding the -100 prefix when the pasted id is only the short number. */
export async function lookupGroup(bot: Bot, raw: string): Promise<GroupLookup> {
  let sawNonGroup = false;
  for (const candidate of groupIdCandidates(raw)) {
    try {
      const chat = await bot.api.getChat(candidate);
      if (chat.type !== "group" && chat.type !== "supergroup") {
        sawNonGroup = true;
        continue;
      }
      return { ok: true, id: String(chat.id), title: chat.title || String(chat.id) };
    } catch (err) {
      const detail = errorText(err);
      if (/chat not found|kicked|not a member|not enough rights|have no rights|forbidden/i.test(detail)) {
        continue;
      }
      throw err;
    }
  }
  return { ok: false, reason: sawNonGroup ? "notgroup" : "notfound" };
}

/** Validate the saved or configured group, rewriting a short id to -100… when found. */
export async function resolveGroupChatId(bot: Bot): Promise<string | null> {
  const saved = await getGroupChatId();
  const raws = new Set([saved, config.groupChatId].filter((id): id is string => Boolean(id)));
  for (const raw of raws) {
    const found = await lookupGroup(bot, raw);
    if (!found.ok) continue;
    if (found.id !== saved) await setGroupChatId(found.id);
    return found.id;
  }
  return null;
}

export async function groupMemberCount(bot: Bot): Promise<number | null> {
  const chatId = await getGroupChatId();
  if (!chatId) return null;
  try {
    return await bot.api.getChatMemberCount(chatId);
  } catch (err) {
    logError("member count", err);
    return null;
  }
}
