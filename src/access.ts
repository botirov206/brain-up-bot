import { isConfiguredAdmin } from "./config.js";
import type { MembershipApi, MembershipCheck } from "./membership.js";
import { checkForumMembership } from "./membership.js";
import { displayName } from "./names.js";
import {
  findUser,
  getGroupChatId,
  pendingActive,
  setUserPending,
  updateUserProfile,
  upsertUser,
  type UserRow,
} from "./repo.js";
import { admitWaitlist, listKnownTelegramIds, saveMembership } from "./store.js";

export type Access =
  | { ok: true; user: UserRow; chatId: string }
  | { ok: false; code: "blocked" | "non_member" | "unavailable" | "bot"; user: UserRow | null; chatId: string | null };

export async function requireParticipantAccess(input: {
  api: MembershipApi;
  telegramId: string;
  name: string;
  username: string | null;
  isBot?: boolean;
}): Promise<Access> {
  if (input.isBot) return { ok: false, code: "bot", user: null, chatId: null };
  const existing = await findUser(input.telegramId);
  if (existing?.blocked_at != null) {
    return { ok: false, code: "blocked", user: existing, chatId: await getGroupChatId() };
  }
  const chatId = await getGroupChatId();
  if (!chatId) return { ok: false, code: "unavailable", user: existing, chatId: null };

  const check = await checkForumMembership(input.api, chatId, input.telegramId);
  if (check.kind === "unavailable") {
    return { ok: false, code: "unavailable", user: existing, chatId };
  }
  await saveMembership(chatId, input.telegramId, check);
  if (check.kind === "non_member") {
    return { ok: false, code: "non_member", user: existing, chatId };
  }

  const user = existing
    ? existing
    : await upsertUser({
        telegramId: input.telegramId,
        name: input.name,
        username: input.username,
        makeAdmin: isConfiguredAdmin(input.telegramId),
        started: false,
      });
  if (existing) await updateUserProfile(existing.id, input.name, input.username);
  await admitWaitlist(user.id);
  const fresh = (await findUser(input.telegramId)) ?? user;
  return { ok: true, user: fresh, chatId };
}

/** Recheck people the bot already knows. Unavailable checks are left unchanged. */
export async function reconcileKnownMemberships(api: MembershipApi): Promise<void> {
  const chatId = await getGroupChatId();
  if (!chatId) return;
  const ids = await listKnownTelegramIds(chatId);
  for (const telegramId of ids) {
    const check = await checkForumMembership(api, chatId, telegramId);
    if (check.kind === "unavailable") continue;
    await saveMembership(chatId, telegramId, check);
    if (check.kind !== "member") continue;
    const user = await findUser(telegramId);
    if (user && user.blocked_at == null) await admitWaitlist(user.id);
  }
}

export async function expirePending(user: UserRow): Promise<UserRow> {
  if (user.pending && !pendingActive(user)) {
    await setUserPending(user.id, null);
    return { ...user, pending: null, pending_payload: null, pending_expires_at: null };
  }
  return user;
}

export function actorName(from: { id: number; first_name: string; last_name?: string; username?: string }): {
  telegramId: string;
  name: string;
  username: string | null;
} {
  return {
    telegramId: String(from.id),
    name: displayName(from),
    username: from.username ?? null,
  };
}
