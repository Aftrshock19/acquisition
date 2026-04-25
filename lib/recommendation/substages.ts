/**
 * Shared rank+target picker for reading and listening recommendations.
 *
 * Two signals drive the pick:
 *   - vocabulary frontier rank → 30-substage bucket (SUBSTAGE_TABLE)
 *   - today's flashcard target → passage length mode (MODE_LENGTH_TABLE)
 *
 * The picker walks a fallback ladder so a missing exact (substage, mode) bucket
 * degrades gracefully:
 *   Phase 1: exact (desiredStage, desiredMode)
 *   Phase 2: same substage, walk modes outward
 *   Phase 3: walk substages outward, desired mode
 *   Phase 4: cross product (nearby substage × nearby mode)
 *
 * Within any (substage, mode) bucket, ties break by lowest passageNumber.
 */

export type PassageMode = "short" | "medium" | "long" | "very_long";

export const MIN_SUBSTAGE = 1;
export const MAX_SUBSTAGE = 30;

export const SUBSTAGE_TABLE: readonly {
  stage: number;
  label: string;
  rankMin: number;
  rankMax: number;
}[] = [
  { stage: 1, label: "A1--", rankMin: 0, rankMax: 150 },
  { stage: 2, label: "A1-", rankMin: 151, rankMax: 350 },
  { stage: 3, label: "A1", rankMin: 351, rankMax: 650 },
  { stage: 4, label: "A1+", rankMin: 651, rankMax: 1050 },
  { stage: 5, label: "A1++", rankMin: 1051, rankMax: 1500 },
  { stage: 6, label: "A2--", rankMin: 1501, rankMax: 1900 },
  { stage: 7, label: "A2-", rankMin: 1901, rankMax: 2400 },
  { stage: 8, label: "A2", rankMin: 2401, rankMax: 2980 },
  { stage: 9, label: "A2+", rankMin: 2981, rankMax: 3620 },
  { stage: 10, label: "A2++", rankMin: 3621, rankMax: 4300 },
  { stage: 11, label: "B1--", rankMin: 4301, rankMax: 5050 },
  { stage: 12, label: "B1-", rankMin: 5051, rankMax: 5900 },
  { stage: 13, label: "B1", rankMin: 5901, rankMax: 6900 },
  { stage: 14, label: "B1+", rankMin: 6901, rankMax: 8000 },
  { stage: 15, label: "B1++", rankMin: 8001, rankMax: 9200 },
  { stage: 16, label: "B2--", rankMin: 9201, rankMax: 10500 },
  { stage: 17, label: "B2-", rankMin: 10501, rankMax: 11950 },
  { stage: 18, label: "B2", rankMin: 11951, rankMax: 13550 },
  { stage: 19, label: "B2+", rankMin: 13551, rankMax: 15250 },
  { stage: 20, label: "B2++", rankMin: 15251, rankMax: 17000 },
  { stage: 21, label: "C1--", rankMin: 17001, rankMax: 18900 },
  { stage: 22, label: "C1-", rankMin: 18901, rankMax: 21000 },
  { stage: 23, label: "C1", rankMin: 21001, rankMax: 23200 },
  { stage: 24, label: "C1+", rankMin: 23201, rankMax: 25400 },
  { stage: 25, label: "C1++", rankMin: 25401, rankMax: 27500 },
  { stage: 26, label: "C2--", rankMin: 27501, rankMax: 29200 },
  { stage: 27, label: "C2-", rankMin: 29201, rankMax: 30900 },
  { stage: 28, label: "C2", rankMin: 30901, rankMax: 32500 },
  { stage: 29, label: "C2+", rankMin: 32501, rankMax: 33900 },
  { stage: 30, label: "C2++", rankMin: 33901, rankMax: 35000 },
] as const;

export const MODE_LENGTH_TABLE: readonly {
  mode: PassageMode;
  targetMin: number;
  targetMax: number | null;
}[] = [
  { mode: "short", targetMin: 0, targetMax: 30 },
  { mode: "medium", targetMin: 31, targetMax: 70 },
  { mode: "long", targetMin: 71, targetMax: 130 },
  { mode: "very_long", targetMin: 131, targetMax: null },
] as const;

export const PASSAGE_MODE_ORDER: readonly PassageMode[] = [
  "short",
  "medium",
  "long",
  "very_long",
];

/**
 * Map a frequency rank to a substage 1..30.
 *
 * Edge cases:
 *   null/undefined/NaN/<=0 → 1 (absolute beginner)
 *   > 35000               → 30 (top of the bank)
 */
export function rankToSubstageIndex(rank: number | null | undefined): number {
  if (rank == null || !Number.isFinite(rank) || rank <= 0) return MIN_SUBSTAGE;
  for (const row of SUBSTAGE_TABLE) {
    if (rank <= row.rankMax) return row.stage;
  }
  return MAX_SUBSTAGE;
}

/**
 * Map today's flashcard target to a passage length mode.
 *
 * Edge cases:
 *   null/undefined/NaN/<=0 → "short" (consistent with 0 ∈ [0,30])
 */
export function targetToPassageMode(
  target: number | null | undefined,
): PassageMode {
  if (target == null || !Number.isFinite(target) || target <= 0) return "short";
  for (const row of MODE_LENGTH_TABLE) {
    if (row.targetMax == null || target <= row.targetMax) return row.mode;
  }
  return "very_long";
}

/**
 * Symmetric outward walk over substage indices.
 *
 * Returns [stage, stage-1, stage+1, stage-2, stage+2, ...] clamped to
 * [MIN_SUBSTAGE, MAX_SUBSTAGE]. The first element is always the input stage.
 * Once a direction hits its boundary, the other direction continues alone.
 */
export function getNearbySubstages(stage: number): number[] {
  const clamped = Math.max(
    MIN_SUBSTAGE,
    Math.min(MAX_SUBSTAGE, Math.round(stage)),
  );
  const out: number[] = [clamped];
  let down = clamped - 1;
  let up = clamped + 1;
  while (down >= MIN_SUBSTAGE || up <= MAX_SUBSTAGE) {
    if (down >= MIN_SUBSTAGE) {
      out.push(down);
      down--;
    }
    if (up <= MAX_SUBSTAGE) {
      out.push(up);
      up++;
    }
  }
  return out;
}

/**
 * Symmetric outward walk over the 4-mode order [short, medium, long, very_long].
 *
 *   short     → [short, medium, long, very_long]
 *   medium    → [medium, short, long, very_long]
 *   long      → [long, medium, very_long, short]
 *   very_long → [very_long, long, medium, short]
 *
 * The first element is always the input mode.
 */
export function getNearbyModes(mode: PassageMode): PassageMode[] {
  const idx = PASSAGE_MODE_ORDER.indexOf(mode);
  if (idx < 0) return [...PASSAGE_MODE_ORDER];
  const out: PassageMode[] = [PASSAGE_MODE_ORDER[idx]];
  let down = idx - 1;
  let up = idx + 1;
  while (down >= 0 || up < PASSAGE_MODE_ORDER.length) {
    if (down >= 0) {
      out.push(PASSAGE_MODE_ORDER[down]);
      down--;
    }
    if (up < PASSAGE_MODE_ORDER.length) {
      out.push(PASSAGE_MODE_ORDER[up]);
      up++;
    }
  }
  return out;
}

/**
 * Minimum shape any candidate passed to pickFromBucketAndMode must expose.
 * Reading and listening recommenders project their summary types into this
 * shape (preserving the original via an extra field on T).
 */
export type Candidate = {
  id: string;
  stageIndex: number | null | undefined;
  passageMode: PassageMode | string | null | undefined;
  passageNumber: number | null | undefined;
};

/**
 * Pick the best candidate matching (rank, target) using the 4-phase fallback.
 * See file header for the phase ordering. Returns null only when every phase
 * exhausts every (substage, mode) combination without finding an eligible
 * candidate.
 *
 * Defensive: skips candidates where stageIndex, passageMode, or passageNumber
 * is null/undefined. Production data is clean, but partial rows from a future
 * import job won't crash the picker or false-match.
 */
export function pickFromBucketAndMode<T extends Candidate>(args: {
  rank: number | null | undefined;
  target: number | null | undefined;
  candidates: readonly T[];
  excludedIds: ReadonlySet<string>;
}): T | null {
  const { rank, target, candidates, excludedIds } = args;
  const desiredStage = rankToSubstageIndex(rank);
  const desiredMode = targetToPassageMode(target);

  const pickAt = (s: number, m: PassageMode): T | null => {
    let best: T | null = null;
    let bestNum = Infinity;
    for (const c of candidates) {
      if (
        c.stageIndex == null ||
        c.passageMode == null ||
        c.passageNumber == null
      ) {
        continue;
      }
      if (c.stageIndex !== s) continue;
      if (c.passageMode !== m) continue;
      if (excludedIds.has(c.id)) continue;
      if (c.passageNumber < bestNum) {
        bestNum = c.passageNumber;
        best = c;
      }
    }
    return best;
  };

  // Phase 1: exact match.
  let hit = pickAt(desiredStage, desiredMode);
  if (hit) return hit;

  const nearbyModes = getNearbyModes(desiredMode);
  const nearbySubstages = getNearbySubstages(desiredStage);

  // Phase 2: same substage, walk modes outward (skip the first which is desiredMode).
  for (let i = 1; i < nearbyModes.length; i++) {
    hit = pickAt(desiredStage, nearbyModes[i]);
    if (hit) return hit;
  }

  // Phase 3: walk substages outward, desired mode (skip the first which is desiredStage).
  for (let i = 1; i < nearbySubstages.length; i++) {
    hit = pickAt(nearbySubstages[i], desiredMode);
    if (hit) return hit;
  }

  // Phase 4: nearby substages × nearby modes (cross product, both skip first).
  for (let i = 1; i < nearbySubstages.length; i++) {
    for (let j = 1; j < nearbyModes.length; j++) {
      hit = pickAt(nearbySubstages[i], nearbyModes[j]);
      if (hit) return hit;
    }
  }

  return null;
}
