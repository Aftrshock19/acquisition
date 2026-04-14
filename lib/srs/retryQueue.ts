/**
 * In-memory, count-based retry queue for same-session flashcard retries.
 *
 * Replaces the 90-second wall-clock delay with a simple rule:
 *   - incorrect cards reappear after RETRY_GAP other answer events
 *   - max MAX_RETRIES same-session retries per card
 *   - no wall-clock delay
 */

/** How many other answer events before a retry surfaces */
export const RETRY_GAP = 5;
/** Maximum same-session retries per card */
export const MAX_RETRIES = 2;

export type RetryQueueEntry<T> = {
  card: T;
  /** How many retries this card has had so far in this session */
  retryCount: number;
  /** Global answer counter value at which this card becomes eligible */
  dueAfterCount: number;
};

/**
 * Serialized shape persisted to localStorage for same-day session resume.
 * Version bump invalidates older payloads so stale in-flight state cannot
 * leak across migrations.
 */
export const RETRY_QUEUE_SERIAL_VERSION = 1 as const;

export type SerializedRetryQueue<T> = {
  version: typeof RETRY_QUEUE_SERIAL_VERSION;
  answerCount: number;
  entries: RetryQueueEntry<T>[];
  retryHistory: Array<[string, number]>;
};

export class RetryQueue<T extends { id: string }> {
  private entries: RetryQueueEntry<T>[] = [];
  private answerCount = 0;
  /** Tracks total retries per card (persists after dequeue) */
  private retryHistory = new Map<string, number>();

  /** Record that an answer event happened (correct or incorrect). */
  recordAnswer(): void {
    this.answerCount++;
  }

  /** Get current answer count (for testing / debugging). */
  getAnswerCount(): number {
    return this.answerCount;
  }

  /**
   * Enqueue a card for retry after RETRY_GAP more answers.
   * Returns false if the card has already exhausted its retry budget.
   */
  enqueue(card: T): boolean {
    const currentRetryCount = this.retryHistory.get(card.id) ?? 0;

    if (currentRetryCount >= MAX_RETRIES) {
      return false;
    }

    // Remove any existing entry for this card
    this.entries = this.entries.filter((e) => e.card.id !== card.id);

    const newCount = currentRetryCount + 1;
    this.retryHistory.set(card.id, newCount);

    this.entries.push({
      card,
      retryCount: newCount,
      dueAfterCount: this.answerCount + RETRY_GAP,
    });

    return true;
  }

  /**
   * Get the retry count for a specific card (how many times it has been retried).
   * Returns 0 if the card has never been enqueued.
   */
  getRetryCount(cardId: string): number {
    return this.retryHistory.get(cardId) ?? 0;
  }

  /**
   * Check if a retry card is ready to be shown.
   * Returns the next due retry entry, or null if none are ready.
   * Does NOT remove it from the queue — call dequeue() to consume it.
   */
  peek(): RetryQueueEntry<T> | null {
    const ready = this.entries.find((e) => e.dueAfterCount <= this.answerCount);
    return ready ?? null;
  }

  /**
   * Remove and return the next ready retry card.
   * Returns null if no retry is currently due.
   */
  dequeue(): RetryQueueEntry<T> | null {
    const idx = this.entries.findIndex(
      (e) => e.dueAfterCount <= this.answerCount,
    );
    if (idx === -1) return null;
    return this.entries.splice(idx, 1)[0];
  }

  /**
   * Force-dequeue the next pending retry, ignoring the gap requirement.
   * Used when the main queue is exhausted and retries would otherwise be stranded.
   * Returns entries in FIFO order by dueAfterCount (earliest-scheduled first).
   */
  forceDequeue(): RetryQueueEntry<T> | null {
    if (this.entries.length === 0) return null;
    // Serve the entry closest to being due first
    let minIdx = 0;
    for (let i = 1; i < this.entries.length; i++) {
      if (this.entries[i].dueAfterCount < this.entries[minIdx].dueAfterCount) {
        minIdx = i;
      }
    }
    return this.entries.splice(minIdx, 1)[0];
  }

  /** How many retries are still pending (not yet served). */
  get pendingCount(): number {
    return this.entries.length;
  }

  /** Whether there are any pending retries (due or not yet due). */
  get hasPending(): boolean {
    return this.entries.length > 0;
  }

  /** Check if a card can still be retried (has budget remaining). */
  canRetry(cardId: string): boolean {
    const currentRetryCount = this.retryHistory.get(cardId) ?? 0;
    return currentRetryCount < MAX_RETRIES;
  }

  /** Reset the queue (e.g., on session restart). */
  reset(): void {
    this.entries = [];
    this.retryHistory.clear();
    this.answerCount = 0;
  }

  /** Snapshot the queue for persistence (e.g., localStorage). */
  serialize(): SerializedRetryQueue<T> {
    return {
      version: RETRY_QUEUE_SERIAL_VERSION,
      answerCount: this.answerCount,
      entries: this.entries.map((e) => ({
        card: e.card,
        retryCount: e.retryCount,
        dueAfterCount: e.dueAfterCount,
      })),
      retryHistory: Array.from(this.retryHistory.entries()),
    };
  }

  /**
   * Rehydrate from a snapshot. Invalid/corrupt payloads are ignored and the
   * queue is left untouched — callers should treat failure as a no-op, not
   * an error.
   */
  hydrate(snapshot: unknown): boolean {
    if (!snapshot || typeof snapshot !== "object") return false;
    const s = snapshot as Partial<SerializedRetryQueue<T>>;
    if (s.version !== RETRY_QUEUE_SERIAL_VERSION) return false;
    if (typeof s.answerCount !== "number" || !Number.isFinite(s.answerCount)) return false;
    if (!Array.isArray(s.entries) || !Array.isArray(s.retryHistory)) return false;

    const entries: RetryQueueEntry<T>[] = [];
    for (const raw of s.entries) {
      if (!raw || typeof raw !== "object") return false;
      const e = raw as Partial<RetryQueueEntry<T>>;
      if (
        !e.card ||
        typeof (e.card as { id?: unknown }).id !== "string" ||
        typeof e.retryCount !== "number" ||
        typeof e.dueAfterCount !== "number"
      ) {
        return false;
      }
      entries.push({
        card: e.card as T,
        retryCount: e.retryCount,
        dueAfterCount: e.dueAfterCount,
      });
    }

    const history = new Map<string, number>();
    for (const pair of s.retryHistory) {
      if (!Array.isArray(pair) || pair.length !== 2) return false;
      const [key, val] = pair;
      if (typeof key !== "string" || typeof val !== "number") return false;
      history.set(key, val);
    }

    this.entries = entries;
    this.retryHistory = history;
    this.answerCount = s.answerCount;
    return true;
  }
}
