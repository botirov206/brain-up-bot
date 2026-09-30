export type TopicOption = { id: number; text: string };

export type AssignmentInput = {
  participantIds: number[];
  topics: TopicOption[];
  recentByUser: Map<number, number[]>;
  already: Map<number, number>;
  random?: () => number;
};

/** One saved topic id per participant. Existing assignments are kept. */
export function chooseAssignments(input: AssignmentInput): Map<number, number> {
  const result = new Map<number, number>(input.already);
  const topics = input.topics.filter((topic) => Number.isInteger(topic.id));
  if (topics.length === 0) return result;

  const pending = input.participantIds.filter((id) => !result.has(id));
  if (pending.length === 0) return result;

  const random = input.random ?? Math.random;
  let cycle = shuffle(topics, random);
  const usedInCycle = new Set<number>();
  const usedToday = new Set<number>(result.values());

  for (const userId of pending) {
    const recent = new Set(input.recentByUser.get(userId) ?? []);
    let available = cycle.filter((topic) => !usedInCycle.has(topic.id));
    if (available.length === 0) {
      cycle = shuffle(topics, random);
      usedInCycle.clear();
      available = cycle;
    }
    const picked = pickTopic(available, usedToday, recent);
    result.set(userId, picked.id);
    usedInCycle.add(picked.id);
    usedToday.add(picked.id);
  }
  return result;
}

function pickTopic(available: TopicOption[], usedToday: Set<number>, recent: Set<number>): TopicOption {
  const unusedToday = available.filter((topic) => !usedToday.has(topic.id));
  const pool = unusedToday.length > 0 ? unusedToday : available;
  const fresh = pool.filter((topic) => !recent.has(topic.id));
  const chosen = fresh[0] ?? pool[0];
  if (!chosen) throw new Error("topic pool was empty");
  return chosen;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const current = copy[index];
    const other = copy[swap];
    if (current === undefined || other === undefined) continue;
    copy[index] = other;
    copy[swap] = current;
  }
  return copy;
}
