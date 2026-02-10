import { md5Hex } from "./hash";

type Status = "loading" | "loaded" | "failed";

const statusMap = new Map<string, Status>();
const urlMap = new Map<string, string>();
const listeners = new Set<() => void>();

let pending = 0;
const MAX_CONCURRENT = 4;
const queue: string[] = [];

function notifyListeners() {
  for (const cb of listeners) cb();
}

function processQueue() {
  while (pending < MAX_CONCURRENT && queue.length > 0) {
    const email = queue.shift()!;
    if (statusMap.get(email) !== "loading") continue;
    pending++;

    const md5 = md5Hex(email);
    const url = `https://www.gravatar.com/avatar/${md5}?d=404&s=64`;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      pending--;
      statusMap.set(email, "loaded");
      urlMap.set(email, url);
      notifyListeners();
      processQueue();
    };
    img.onerror = () => {
      pending--;
      statusMap.set(email, "failed");
      processQueue();
    };
    img.src = url;
  }
}

export function requestGravatar(email: string): void {
  if (statusMap.has(email)) return;
  statusMap.set(email, "loading");
  queue.push(email);
  processQueue();
}

export function getGravatarUrl(email: string): string | null {
  return urlMap.get(email) ?? null;
}

export function isGravatarFailed(email: string): boolean {
  return statusMap.get(email) === "failed";
}

export function subscribeGravatarCache(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function clearGravatarCache(): void {
  statusMap.clear();
  urlMap.clear();
  queue.length = 0;
}
