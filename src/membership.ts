export type MembershipCheck =
  | { kind: "member"; telegramStatus: string }
  | { kind: "non_member"; telegramStatus: string }
  | { kind: "unavailable"; reason: string };

export type ChatMemberLike = {
  status: string;
  is_member?: boolean;
  user?: { id?: number; is_bot?: boolean };
};

export type MembershipApi = {
  getChatMember: (chatId: string | number, userId: number) => Promise<ChatMemberLike>;
};

const MEMBER_STATUSES = new Set(["creator", "administrator", "member"]);

export function classifyChatMember(member: ChatMemberLike): MembershipCheck {
  const status = member.status;
  if (MEMBER_STATUSES.has(status)) return { kind: "member", telegramStatus: status };
  if (status === "restricted") {
    return member.is_member === true
      ? { kind: "member", telegramStatus: status }
      : { kind: "non_member", telegramStatus: status };
  }
  if (status === "left" || status === "kicked") return { kind: "non_member", telegramStatus: status };
  return { kind: "unavailable", reason: `unexpected status ${status}` };
}

export function isForumAdminStatus(status: string): boolean {
  return status === "creator" || status === "administrator";
}

/** Errors are unverifiable. They are never treated as "left the forum". */
export async function checkForumMembership(
  api: MembershipApi,
  chatId: string,
  telegramId: string,
): Promise<MembershipCheck> {
  if (!/^-?\d+$/.test(chatId) || !/^\d+$/.test(telegramId)) {
    return { kind: "unavailable", reason: "invalid id" };
  }
  try {
    const member = await api.getChatMember(chatId, Number(telegramId));
    return classifyChatMember(member);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (/timeout|timed out|ETELEGRAM|network|ECONN|fetch failed|socket hang up/i.test(detail)) {
      return { kind: "unavailable", reason: "telegram timeout" };
    }
    if (/not enough rights|not admin|administrator|CHAT_ADMIN_REQUIRED|have no rights|forbidden|kicked from|chat not found|bot was kicked|need administrator/i.test(detail)) {
      return { kind: "unavailable", reason: "bot cannot verify membership" };
    }
    return { kind: "unavailable", reason: "membership check failed" };
  }
}
