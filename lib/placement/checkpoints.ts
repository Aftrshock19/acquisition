/**
 * Adaptive placement checkpoints.
 *
 * Eleven log-spaced rank centers spanning the full Spanish frequency table
 * (~34k entries). The diagnostic hops between checkpoints rather than walking
 * row-by-row, so 8–24 items can place a learner anywhere from rank 250 to
 * the top of the bank.
 *
 * Each checkpoint has a window the item picker uses when sampling a real
 * baseline_item_bank row near that checkpoint's center.
 */

export type Checkpoint = {
  index: number;
  center: number;
  windowLow: number;
  windowHigh: number;
  label: string;
};

const RAW_CENTERS = [
  250, 500, 1000, 1750, 3000, 5000, 8000, 12000, 18000, 26000, 34000,
] as const;

function buildCheckpoints(): Checkpoint[] {
  return RAW_CENTERS.map((center, index) => {
    // Roughly ±20% window, with a small minimum so the lowest checkpoint
    // still has a usable range.
    const span = Math.max(120, Math.round(center * 0.2));
    const windowLow = Math.max(1, center - span);
    const windowHigh = center + span;
    return {
      index,
      center,
      windowLow,
      windowHigh,
      label: `~${center.toLocaleString()}`,
    };
  });
}

export const CHECKPOINTS: readonly Checkpoint[] = buildCheckpoints();

export const TOP_CHECKPOINT_INDEX = CHECKPOINTS.length - 1;
export const MAX_CHECKPOINT_RANK = CHECKPOINTS[TOP_CHECKPOINT_INDEX].center;
export const MIN_CHECKPOINT_RANK = CHECKPOINTS[0].center;

export function checkpointByIndex(index: number): Checkpoint | null {
  if (index < 0 || index >= CHECKPOINTS.length) return null;
  return CHECKPOINTS[index];
}

/** Map an arbitrary rank to the nearest checkpoint index (by log distance). */
export function nearestCheckpointIndex(rank: number): number {
  if (rank <= CHECKPOINTS[0].center) return 0;
  if (rank >= MAX_CHECKPOINT_RANK) return TOP_CHECKPOINT_INDEX;
  const target = Math.log(rank);
  let bestIdx = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const c of CHECKPOINTS) {
    const d = Math.abs(Math.log(c.center) - target);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = c.index;
    }
  }
  return bestIdx;
}

/**
 * Default starting checkpoint when there is no prior estimate.
 * Index 4 = rank 3000, a forgiving midpoint that fails fast for both
 * absolute beginners and advanced learners.
 */
export const DEFAULT_START_INDEX = 4;
