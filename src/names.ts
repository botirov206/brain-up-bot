export function displayName(from: {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}): string {
  const full = [from.first_name, from.last_name]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ")
    .trim();
  // Do not prefix @. A leading @ in the group would mention the person.
  const name = full || from.username || String(from.id);
  return name.slice(0, 120);
}
