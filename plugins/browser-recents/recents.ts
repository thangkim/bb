export const RECENT_LINK_LIMIT = 8;
const BROWSER_HISTORY_KEY = /^bb\.thread\.browserHistory-.+-1$/;

export interface RecentLink {
  url: string;
  title: string | null;
  visitedAt: number;
}

function parseEntry(value: unknown): RecentLink | null {
  if (typeof value !== "object" || value === null) return null;
  const { url, title, visitedAt } = value as Record<string, unknown>;
  if (typeof url !== "string" || url.length === 0) return null;
  if (typeof visitedAt !== "number" || !Number.isFinite(visitedAt)) return null;
  const trimmedTitle = typeof title === "string" ? title.trim() : "";
  return {
    url,
    title: trimmedTitle.length > 0 ? trimmedTitle : null,
    visitedAt,
  };
}

function parseHistory(raw: string | null): RecentLink[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => parseEntry(value) ?? []);
  } catch {
    return [];
  }
}

export function readRecentLinks(
  storage: Storage,
  limit: number = RECENT_LINK_LIMIT,
): RecentLink[] {
  const byUrl = new Map<string, RecentLink>();
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key === null || !BROWSER_HISTORY_KEY.test(key)) continue;
    for (const entry of parseHistory(storage.getItem(key))) {
      const existing = byUrl.get(entry.url);
      if (existing === undefined || entry.visitedAt > existing.visitedAt) {
        byUrl.set(entry.url, {
          ...entry,
          title: entry.title ?? existing?.title ?? null,
        });
      } else if (existing.title === null && entry.title !== null) {
        byUrl.set(entry.url, { ...existing, title: entry.title });
      }
    }
  }
  return [...byUrl.values()]
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, limit);
}

export function linkHost(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export function formatVisitedAt(timestamp: number, now: number): string {
  const diff = now - timestamp;
  if (diff < MINUTE_MS) return "just now";
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)}m ago`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}h ago`;
  const days = Math.floor(diff / DAY_MS);
  if (days === 1) return "Yesterday";
  if (diff < WEEK_MS) return `${days}d ago`;
  if (diff < 5 * WEEK_MS) return `${Math.floor(diff / WEEK_MS)}w ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
