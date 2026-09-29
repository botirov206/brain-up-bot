/** Possible Bot API ids for a value an admin pasted or left in .env. */
export function groupIdCandidates(raw: string): string[] {
  const id = raw.trim();
  if (!/^-?\d+$/.test(id)) return [];
  const candidates = [id];
  if (/^\d+$/.test(id)) candidates.push(`-100${id}`);
  else if (!id.startsWith("-100")) candidates.push(`-100${id.slice(1)}`);
  return [...new Set(candidates)];
}
