export const MESSAGE_BUDGET = 3500;

export type Page<T> = {
  page: number;
  pages: number;
  total: number;
  items: T[];
};

export function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  const size = Math.max(1, pageSize);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const safe = Math.min(Math.max(0, page), pages - 1);
  const start = safe * size;
  return { page: safe, pages, total: items.length, items: items.slice(start, start + size) };
}

export function navigationLabels(page: number, pages: number): { prev: boolean; next: boolean } {
  if (pages <= 1) return { prev: false, next: false };
  return { prev: page > 0, next: page < pages - 1 };
}

/** Shrink the page until the rendered text fits. Never go below one item. */
export function fitPageSize(requested: number, measure: (pageSize: number) => number, budget = MESSAGE_BUDGET): number {
  let size = Math.max(1, requested);
  while (size > 1 && measure(size) > budget) size -= 1;
  return size;
}

export function splitBlocks(blocks: string[], budget = MESSAGE_BUDGET): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  const pushCurrent = (): void => {
    if (current.length === 0) return;
    chunks.push(current.join("\n"));
    current = [];
    size = 0;
  };
  for (const block of blocks) {
    const piece = block.length > budget ? block.slice(0, budget) : block;
    const next = size + piece.length + (current.length > 0 ? 1 : 0);
    if (current.length > 0 && next > budget) pushCurrent();
    current.push(piece);
    size += piece.length + (current.length > 1 ? 1 : 0);
  }
  pushCurrent();
  return chunks.length > 0 ? chunks : [""];
}
