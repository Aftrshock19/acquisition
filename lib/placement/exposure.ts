/**
 * Retake-aware item exposure control.
 *
 * Pure functions only. The DB-side picker fetches a pool of candidate items
 * around a target rank and a per-user exposure history; this module decides
 * which item from that pool the diagnostic should serve next.
 *
 * Goals (see PR description for the full retake design):
 *   - second attempt path differs from the first under normal pool conditions
 *   - exclude items already used in the *current* attempt entirely
 *   - exclude items used in the *immediately previous completed attempt*
 *   - penalize items seen in any of the last few attempts
 *   - on pool exhaustion, allow reuse but record `reuseDueToPoolExhaustion`
 *   - keep the picked item near the target rank (log-distance scoring)
 *   - controlled randomness: reproducible per (runId, sequenceIndex), but
 *     different across attempts
 */

// ── Seeded RNG ─────────────────────────────────────────────

/**
 * 32-bit FNV-1a hash. Cheap, deterministic, and stable across processes —
 * good enough for selecting among ~6 candidates.
 */
function fnv1a(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32 — small, fast, deterministic PRNG seeded by a 32-bit int. */
export function seededRandom(seed: string): () => number {
  let s = fnv1a(seed) || 0xdeadbeef;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Types ─────────────────────────────────────────────────

/** Exposure facts about a single item, derived from prior runs. */
export type ItemExposure = {
  /** Number of distinct prior attempts (run_ids) that served this item. */
  attemptCount: number;
  /** True if this item was served in the most recent prior attempt. */
  inImmediatePrevious: boolean;
  /** True if this item was served in any of the last 3 prior attempts. */
  inRecentWindow: boolean;
  /** ms timestamp of the most recent prior service, or null. */
  lastSeenAt: number | null;
};

const ZERO_EXPOSURE: ItemExposure = {
  attemptCount: 0,
  inImmediatePrevious: false,
  inRecentWindow: false,
  lastSeenAt: null,
};

/** Exposure map keyed by item_bank_id. Items absent from the map are unseen. */
export type ExposureMap = ReadonlyMap<string, ItemExposure>;

/** A candidate item the picker may serve next. */
export type PoolCandidate = {
  itemBankId: string;
  frequencyRank: number;
};

export type SelectionContext = {
  /** Rank we are targeting at this checkpoint. */
  targetRank: number;
  /** Item bank ids already used in *this* attempt — hard exclude. */
  excludeIds: ReadonlySet<string>;
  /** Per-user exposure history from prior attempts. */
  exposure: ExposureMap;
  /** Seed string. Should embed runId + sequenceIndex for reproducibility. */
  seed: string;
  /** How many top-scoring candidates to randomize among. Default 6. */
  topK?: number;
  /** Now in ms; injectable for tests. Default Date.now(). */
  nowMs?: number;
};

export type SelectionResult = {
  pickedId: string;
  reuseDueToPoolExhaustion: boolean;
  previousAttemptSeen: boolean;
  /** For tracing: how many candidates remained after each filter pass. */
  trace: {
    poolSize: number;
    eligibleCount: number;
    fallbackTier: "fresh" | "penalized_recent" | "previous_attempt_reuse";
  };
};

// ── Build exposure map from raw response rows ──────────────

export type PriorResponseRow = {
  run_id: string;
  item_bank_id: string | null;
  answered_at: string;
};

/**
 * Group prior diagnostic responses by item, marking which items were served
 * in the immediately previous attempt and which appeared in any of the last
 * three attempts.
 *
 * `priorRuns` should be an array of run_ids ordered most-recent-first
 * (excluding the current run). The first entry is the "immediately previous"
 * attempt.
 */
export function buildExposureMap(
  rows: readonly PriorResponseRow[],
  priorRuns: readonly string[],
): ExposureMap {
  const recentSet = new Set(priorRuns.slice(0, 3));
  const immediatePrev = priorRuns[0] ?? null;

  const map = new Map<string, ItemExposure>();
  // First pass: group runs per item.
  const seenRuns = new Map<string, Set<string>>();
  const lastSeen = new Map<string, number>();
  for (const r of rows) {
    if (!r.item_bank_id) continue;
    const runs = seenRuns.get(r.item_bank_id) ?? new Set<string>();
    runs.add(r.run_id);
    seenRuns.set(r.item_bank_id, runs);
    const ts = Date.parse(r.answered_at);
    if (!Number.isNaN(ts)) {
      const cur = lastSeen.get(r.item_bank_id) ?? 0;
      if (ts > cur) lastSeen.set(r.item_bank_id, ts);
    }
  }
  for (const [itemId, runs] of seenRuns) {
    let inRecentWindow = false;
    let inImmediatePrevious = false;
    for (const rid of runs) {
      if (immediatePrev && rid === immediatePrev) inImmediatePrevious = true;
      if (recentSet.has(rid)) inRecentWindow = true;
    }
    map.set(itemId, {
      attemptCount: runs.size,
      inImmediatePrevious,
      inRecentWindow,
      lastSeenAt: lastSeen.get(itemId) ?? null,
    });
  }
  return map;
}

// ── Scoring ───────────────────────────────────────────────

/** Log-rank distance from candidate to target. Lower is closer. */
function logDistance(rank: number, target: number): number {
  return Math.abs(Math.log(Math.max(1, rank)) - Math.log(Math.max(1, target)));
}

/**
 * Score a candidate at a given exposure tier. Higher = better.
 * The tier-based bonus dominates raw distance, so we always prefer fresh
 * items unless none are available.
 */
function scoreCandidate(
  c: PoolCandidate,
  exposure: ItemExposure,
  ctx: SelectionContext,
): number {
  const distance = logDistance(c.frequencyRank, ctx.targetRank);
  const distanceScore = -distance * 4;
  // Soft penalty per past attempt (in addition to the hard tiering below).
  const exposurePenalty = exposure.attemptCount * 0.5;
  // Mild long-term decay so that an item not seen in a long time becomes
  // marginally more eligible than one seen yesterday.
  const now = ctx.nowMs ?? Date.now();
  const days =
    exposure.lastSeenAt != null
      ? Math.max(0, (now - exposure.lastSeenAt) / 86_400_000)
      : Number.POSITIVE_INFINITY;
  const recencyPenalty = Number.isFinite(days) ? Math.max(0, 1 - days / 30) : 0;
  return distanceScore - exposurePenalty - recencyPenalty;
}

// ── Selection ─────────────────────────────────────────────

/**
 * Pick one item from the candidate pool, respecting current-attempt
 * exclusions and prior-attempt exposure. Returns null if the pool is empty
 * or every candidate is excluded — the caller should widen the rank window
 * and try again before falling back to a hard reuse.
 */
export function selectFromPool(
  pool: readonly PoolCandidate[],
  ctx: SelectionContext,
): SelectionResult | null {
  const topK = ctx.topK ?? 6;
  const usable = pool.filter((c) => !ctx.excludeIds.has(c.itemBankId));
  if (usable.length === 0) return null;

  type Tier = "fresh" | "penalized_recent" | "previous_attempt_reuse";
  const tiers: { name: Tier; cands: PoolCandidate[] }[] = [
    {
      name: "fresh",
      cands: usable.filter((c) => {
        const e = ctx.exposure.get(c.itemBankId) ?? ZERO_EXPOSURE;
        return !e.inImmediatePrevious && !e.inRecentWindow;
      }),
    },
    {
      name: "penalized_recent",
      cands: usable.filter((c) => {
        const e = ctx.exposure.get(c.itemBankId) ?? ZERO_EXPOSURE;
        return !e.inImmediatePrevious;
      }),
    },
    { name: "previous_attempt_reuse", cands: usable },
  ];

  let chosenTier: Tier = "fresh";
  let candidates: PoolCandidate[] = [];
  for (const tier of tiers) {
    if (tier.cands.length > 0) {
      chosenTier = tier.name;
      candidates = tier.cands;
      break;
    }
  }
  if (candidates.length === 0) return null;

  // Score and sort candidates within the chosen tier.
  const scored = candidates
    .map((c) => {
      const e = ctx.exposure.get(c.itemBankId) ?? ZERO_EXPOSURE;
      return { c, score: scoreCandidate(c, e, ctx) };
    })
    .sort((a, b) => b.score - a.score);

  // Restrict the random-pick set to items whose score is within a small gap
  // of the best — this guarantees we never randomize across far outliers.
  // The gap is 1.6, which corresponds to ~±50% in linear rank under our
  // log-distance scoring (4 × ln(1.5) ≈ 1.62).
  const SCORE_GAP = 1.6;
  const bestScore = scored[0].score;
  const tied = scored.filter((s) => bestScore - s.score <= SCORE_GAP);
  const top = tied.slice(0, Math.max(1, topK));

  const rng = seededRandom(ctx.seed);
  const pick = top[Math.floor(rng() * top.length)] ?? top[0];

  const exposure = ctx.exposure.get(pick.c.itemBankId) ?? ZERO_EXPOSURE;
  return {
    pickedId: pick.c.itemBankId,
    reuseDueToPoolExhaustion: chosenTier === "previous_attempt_reuse",
    previousAttemptSeen: exposure.inImmediatePrevious,
    trace: {
      poolSize: pool.length,
      eligibleCount: candidates.length,
      fallbackTier: chosenTier,
    },
  };
}
