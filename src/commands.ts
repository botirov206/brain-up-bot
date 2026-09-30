export type ParsedCommand = {
  name: string;
  body: string;
};

/** Parse a full message. Commands aimed at another bot are ignored. */
export function parseCommand(text: string, botUsername?: string): ParsedCommand | null {
  const match = /^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  const name = match[1]?.toLowerCase();
  const mention = match[2];
  if (!name) return null;
  if (mention && botUsername && mention.toLowerCase() !== botUsername.toLowerCase()) return null;
  return { name, body: (match[3] ?? "").trim() };
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
