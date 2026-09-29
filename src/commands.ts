export type ParsedCommand = {
  name: string;
  body: string;
};

/** Parse a full message. The body keeps internal newlines (for /topics add). */
export function parseCommand(text: string): ParsedCommand | null {
  const match = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  const name = match[1]?.toLowerCase();
  if (!name) return null;
  return { name, body: (match[2] ?? "").trim() };
}

/**
 * Text of one topic from `/topics add ...` or `/topicadd ...`.
 * Returns null when the message is not an add command.
 */
export function topicAddText(commandName: string, body: string): string | null {
  if (commandName === "topicadd") return body.trim();
  if (commandName !== "topics") return null;
  const match = /^add(?:\s+|$)([\s\S]*)$/i.exec(body);
  if (!match) return null;
  return (match[1] ?? "").trim();
}
