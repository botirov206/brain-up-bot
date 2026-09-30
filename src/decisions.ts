export type Requirement = "wake" | "plan" | "topic_response";

export function shouldOpenCase(input: {
  requirement: Requirement;
  membership: "member" | "non_member" | "unavailable";
  blocked: boolean;
  admittedAt: Date | null;
  deadline: Date;
  met: boolean;
  assignmentPostedAt: Date | null;
}): boolean {
  if (input.blocked || input.met) return false;
  if (input.membership !== "member") return false;
  if (input.admittedAt && input.admittedAt.getTime() > input.deadline.getTime()) return false;
  if (input.requirement === "topic_response") {
    if (!input.assignmentPostedAt) return false;
    if (input.assignmentPostedAt.getTime() > input.deadline.getTime()) return false;
  }
  return true;
}

export function completionAction(input: {
  completed: boolean;
  revision: number;
  requested: boolean;
  expectedRevision: number;
}): "apply" | "refresh" {
  if (input.revision !== input.expectedRevision) return "refresh";
  if (input.completed === input.requested) return "refresh";
  return "apply";
}

export type SendFailure = { kind: "retry"; delayMs: number } | { kind: "uncertain" } | { kind: "fail" };

export function classifySendError(err: unknown, attempts: number): SendFailure {
  const text = err instanceof Error ? err.message : String(err);
  const retryAfter = /retry after (\d+)/i.exec(text);
  if (retryAfter?.[1]) return { kind: "retry", delayMs: Number(retryAfter[1]) * 1000 };
  if (/timeout|timed out|socket hang up|ECONNRESET|EAI_AGAIN|fetch failed|network/i.test(text)) {
    return { kind: "uncertain" };
  }
  if (/forbidden|blocked by the user|bot was blocked|chat not found|have no rights|not enough rights|message thread not found/i.test(text)) {
    return { kind: "fail" };
  }
  if (attempts >= 5) return { kind: "fail" };
  return { kind: "retry", delayMs: 15_000 };
}
