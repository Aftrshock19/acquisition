import type { RetryQueue, SerializedRetryQueue } from "./retryQueue";

const STORAGE_PREFIX = "srs.retryQueue.v1";
const KEY_INDEX = `${STORAGE_PREFIX}.index`;

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function makeKey(userId: string, sessionDate: string, sessionId?: string | null): string {
  const suffix = sessionId ? `.${sessionId}` : "";
  return `${STORAGE_PREFIX}.${userId}.${sessionDate}${suffix}`;
}

/**
 * Track all known keys in a small index so we can sweep stale entries
 * (previous days, other users) without enumerating the full localStorage.
 */
function readIndex(store: Storage): string[] {
  try {
    const raw = store.getItem(KEY_INDEX);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

function writeIndex(store: Storage, keys: string[]): void {
  try {
    store.setItem(KEY_INDEX, JSON.stringify(keys));
  } catch {
    // Quota / private mode — swallow.
  }
}

export function persistRetryQueue<T extends { id: string }>(params: {
  userId: string;
  sessionDate: string;
  sessionId?: string | null;
  queue: RetryQueue<T>;
}): void {
  const store = storage();
  if (!store) return;
  const key = makeKey(params.userId, params.sessionDate, params.sessionId);
  const snapshot = params.queue.serialize();
  try {
    // Skip the write if nothing useful to preserve — keeps localStorage tidy.
    if (snapshot.entries.length === 0 && snapshot.answerCount === 0) {
      store.removeItem(key);
      removeFromIndex(store, key);
      return;
    }
    store.setItem(key, JSON.stringify(snapshot));
    addToIndex(store, key);
  } catch {
    // Ignore quota / private-mode errors.
  }
}

export function loadRetryQueue<T extends { id: string }>(params: {
  userId: string;
  sessionDate: string;
  sessionId?: string | null;
  queue: RetryQueue<T>;
}): boolean {
  const store = storage();
  if (!store) return false;
  const key = makeKey(params.userId, params.sessionDate, params.sessionId);
  try {
    const raw = store.getItem(key);
    if (!raw) return false;
    const parsed: unknown = JSON.parse(raw);
    const ok = params.queue.hydrate(parsed as SerializedRetryQueue<T>);
    if (!ok) {
      store.removeItem(key);
      removeFromIndex(store, key);
    }
    return ok;
  } catch {
    try {
      store.removeItem(key);
      removeFromIndex(store, key);
    } catch {
      /* noop */
    }
    return false;
  }
}

export function clearRetryQueue(params: {
  userId: string;
  sessionDate: string;
  sessionId?: string | null;
}): void {
  const store = storage();
  if (!store) return;
  const key = makeKey(params.userId, params.sessionDate, params.sessionId);
  try {
    store.removeItem(key);
    removeFromIndex(store, key);
  } catch {
    /* noop */
  }
}

/**
 * Drop any persisted retry state that does not belong to the current user +
 * session date. Call on mount so yesterday's stranded retries cannot leak
 * into today, and so signing in as a different user starts clean.
 */
export function sweepStaleRetryQueues(current: {
  userId: string;
  sessionDate: string;
  sessionId?: string | null;
}): void {
  const store = storage();
  if (!store) return;
  const currentKey = makeKey(current.userId, current.sessionDate, current.sessionId);
  const keys = readIndex(store);
  const kept: string[] = [];
  for (const k of keys) {
    if (k === currentKey) {
      kept.push(k);
      continue;
    }
    // Same user + same date prefix (but different session id) — also keep,
    // so mid-day session-id churn doesn't erase a valid pending retry.
    const sameUserDate = k.startsWith(`${STORAGE_PREFIX}.${current.userId}.${current.sessionDate}`);
    if (sameUserDate) {
      kept.push(k);
      continue;
    }
    try {
      store.removeItem(k);
    } catch {
      /* noop */
    }
  }
  if (kept.length !== keys.length) writeIndex(store, kept);
}

function addToIndex(store: Storage, key: string): void {
  const keys = readIndex(store);
  if (keys.includes(key)) return;
  keys.push(key);
  writeIndex(store, keys);
}

function removeFromIndex(store: Storage, key: string): void {
  const keys = readIndex(store);
  const filtered = keys.filter((k) => k !== key);
  if (filtered.length !== keys.length) writeIndex(store, filtered);
}
