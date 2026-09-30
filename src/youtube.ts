export type TextEntity = {
  type: string;
  offset: number;
  length: number;
  url?: string;
};

const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function canonicalYoutubeUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/[),.;]+$/g, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!HOSTS.has(host)) return null;

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    if (!id || !VIDEO_ID.test(id)) return null;
    return `https://youtu.be/${id}`;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const head = parts[0]?.toLowerCase();
  if (head === "watch") {
    const id = url.searchParams.get("v");
    if (!id || !VIDEO_ID.test(id)) return null;
    return `https://www.youtube.com/watch?v=${id}`;
  }
  if ((head === "shorts" || head === "live" || head === "embed") && parts[1] && VIDEO_ID.test(parts[1])) {
    return `https://www.youtube.com/${head}/${parts[1]}`;
  }
  return null;
}

export function extractYoutubeUrls(text: string, entities: TextEntity[] = []): string[] {
  const found: string[] = [];
  const push = (raw: string | undefined): void => {
    if (!raw) return;
    const canonical = canonicalYoutubeUrl(raw);
    if (canonical && !found.includes(canonical)) found.push(canonical);
  };

  for (const entity of entities) {
    if (entity.type === "text_link") push(entity.url);
    if (entity.type === "url") push(text.slice(entity.offset, entity.offset + entity.length));
  }
  for (const match of text.match(/https:\/\/[^\s<>"']+/gi) ?? []) push(match);
  return found;
}
