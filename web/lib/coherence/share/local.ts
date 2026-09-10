const KEY = "coherence-chronology-share-v1";

export type ChronologyShareHandle = {
  briefId: string;
  url: string;
  token: string;
  updateSecret: string;
  expiresAt: string;
  publishedAt: string;
};

function readAll(): ChronologyShareHandle[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as ChronologyShareHandle[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeAll(items: ChronologyShareHandle[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // quota
  }
}

export function loadShareHandle(briefId: string): ChronologyShareHandle | null {
  return readAll().find((item) => item.briefId === briefId) ?? null;
}

export function saveShareHandle(handle: ChronologyShareHandle) {
  const items = readAll().filter((item) => item.briefId !== handle.briefId);
  items.unshift(handle);
  writeAll(items.slice(0, 20));
}

export function clearShareHandle(briefId: string) {
  writeAll(readAll().filter((item) => item.briefId !== briefId));
}

export { tokenFromShareUrl, shareNotesUrl, shareNotesPath } from "./urls";
