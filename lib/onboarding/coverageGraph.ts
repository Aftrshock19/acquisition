/**
 * Pure helpers for the onboarding "estimated text coverage" screen.
 *
 * The graph answers a user-facing question: *"If I learn the most common N
 * words, roughly how much of a typical Spanish text would I recognise?"*
 *
 * Numbers are derived from the app's own static reading corpus at build
 * time (see scripts/compute_onboarding_coverage.ts). For each bucket N,
 * we tokenise every passage_text in reading_passages/, rank words by
 * descending within-corpus frequency, and compute
 *
 *     coverage(N) = tokens covered by the top-N words / total tokens
 *
 * This is an *estimate* tied to the app's own content — not a universal
 * comprehension guarantee across all Spanish texts. UI copy must frame
 * this as "roughly how many words you'd recognise in a typical text",
 * never "you will understand X% of every text".
 */

import {
  COVERAGE_BUCKETS,
  COVERAGE_CORPUS_STATS,
  COVERAGE_CURVE,
} from "./coverageData";

export type CoveragePoint = { readonly x: number; readonly y: number };

export const TOP_N_BUCKETS = [100, 500, 1000, 2000, 5000] as const;
export type TopNBucket = (typeof TOP_N_BUCKETS)[number];

export const COVERAGE_MIN_RANK = 10;
export const COVERAGE_MAX_RANK = 5000;

export { COVERAGE_CORPUS_STATS };

export type CoverageGraphState = {
  bucket: TopNBucket;
  /** Short calm explanation for the selected bucket. */
  caption: string;
  /** Estimated text coverage fraction in [0,1]. */
  coverageFraction: number;
  /** Same value as an integer percent, pre-rounded for display. */
  coveragePercent: number;
};

const CAPTIONS: Record<TopNBucket, string> = {
  100: "A small start changes a lot. Very quickly, Spanish stops feeling completely unknown.",
  500: "You are no longer staring at a wall of text. Familiar words begin anchoring what you read.",
  1000: "At this point, you can often hold onto the message even when some words are missing.",
  2000: "More and more of each text starts connecting. This is where reading begins to feel genuinely rewarding.",
  5000: "You have built strong momentum. Much more of real Spanish is now accessible, and progress keeps compounding.",
};

const BUCKET_COVERAGE: Record<TopNBucket, number> = (() => {
  const out = {} as Record<TopNBucket, number>;
  for (const b of TOP_N_BUCKETS) {
    const entry = COVERAGE_BUCKETS.find((e) => e.bucket === b);
    if (!entry) {
      throw new Error(
        `coverageGraph: missing coverage data for bucket ${b}. Re-run scripts/compute_onboarding_coverage.ts.`,
      );
    }
    out[b] = entry.coverage;
  }
  return out;
})();

/**
 * Estimated fraction of running tokens in a typical text that a learner
 * would recognise from knowing the top-`bucket` most frequent words.
 * Derived from the app's own reading corpus. Always in [0,1].
 */
export function coverageFractionForBucket(bucket: TopNBucket): number {
  return BUCKET_COVERAGE[bucket];
}

export function coverageGraphState(bucket: TopNBucket): CoverageGraphState {
  const frac = coverageFractionForBucket(bucket);
  return {
    bucket,
    caption: CAPTIONS[bucket],
    coverageFraction: frac,
    coveragePercent: Math.round(frac * 100),
  };
}

/**
 * Samples along the estimated-coverage curve for SVG rendering. The stored
 * dataset is rank-anchored; we project each (rank, coverage) pair to screen
 * space via topNXPosition, so the curve and any marker drawn with the same
 * helper stay in exact agreement. X in [0,1], Y in [0,1], monotone on both.
 * If the caller asks for fewer/more samples than are stored, we resample by
 * linear interpolation on the softened x axis.
 */
export function coverageCurveSamples(
  sampleCount = COVERAGE_CURVE.length,
): CoveragePoint[] {
  if (sampleCount < 2) sampleCount = 2;
  const base: CoveragePoint[] = COVERAGE_CURVE.map((p) => ({
    x: topNXPosition(p.rank),
    y: p.coverage,
  }));
  if (sampleCount === base.length) return base;
  const out: CoveragePoint[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = i / (sampleCount - 1);
    out.push({ x: t, y: interpolateCurveYFrom(base, t) });
  }
  return out;
}

function interpolateCurveYFrom(base: CoveragePoint[], x: number): number {
  if (x <= base[0].x) return base[0].y;
  const last = base[base.length - 1];
  if (x >= last.x) return last.y;
  for (let i = 1; i < base.length; i++) {
    const a = base[i - 1];
    const b = base[i];
    if (x <= b.x) {
      const span = b.x - a.x;
      const t = span <= 0 ? 0 : (x - a.x) / span;
      return a.y + t * (b.y - a.y);
    }
  }
  return last.y;
}

function interpolateCurveY(x: number): number {
  return interpolateCurveYFrom(
    COVERAGE_CURVE.map((p) => ({ x: topNXPosition(p.rank), y: p.coverage })),
    x,
  );
}

/**
 * Where (on 0..1) the selected bucket sits along the log-scaled x-axis.
 * Matches the x-coordinate used when sampling the curve so the marker
 * lands exactly on it.
 */
export function bucketXPosition(bucket: TopNBucket): number {
  return topNXPosition(bucket);
}

/** Log-scaled x-position for any top-N value in [1, COVERAGE_MAX_RANK]. */
const X_SOFTENING = 2.5;

export function topNXPosition(topN: number): number {
  const clamped = Math.max(1, Math.min(COVERAGE_MAX_RANK, topN));
  const raw = Math.log(clamped) / Math.log(COVERAGE_MAX_RANK);
  return Math.pow(raw, X_SOFTENING);
}

/**
 * Estimated coverage fraction for any top-N (not just the preset buckets),
 * interpolated from the precomputed curve. Intended for driving a continuous
 * slider. Clamps topN to [1, COVERAGE_MAX_RANK].
 */
export function coverageFractionForTopN(topN: number): number {
  return interpolateCurveY(topNXPosition(topN));
}

/** Nearest-by-log-distance preset bucket for a free-form top-N value. */
export function nearestBucket(topN: number): TopNBucket {
  const x = topNXPosition(topN);
  let best: TopNBucket = TOP_N_BUCKETS[0];
  let bestDist = Infinity;
  for (const b of TOP_N_BUCKETS) {
    const d = Math.abs(bucketXPosition(b) - x);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return best;
}

export type TopNGraphState = {
  topN: number;
  caption: string;
  coverageFraction: number;
  coveragePercent: number;
  nearestBucket: TopNBucket;
};

/**
 * Continuous version of coverageGraphState: works for any top-N, picks the
 * most fitting preset caption by nearest log-rank distance, and returns
 * interpolated coverage.
 */

export function topNGraphState(topN: number): TopNGraphState {
  const clamped = Math.max(1, Math.min(COVERAGE_MAX_RANK, Math.round(topN)));
  const frac = coverageFractionForTopN(clamped);
  const bucket = nearestBucket(clamped);
  return {
    topN: clamped,
    caption: CAPTIONS[bucket],
    coverageFraction: frac,
    coveragePercent: Math.round(frac * 100),
    nearestBucket: bucket,
  };
}

export function topNFromXPosition(x: number): number {
  const clamped = Math.max(0, Math.min(1, x));
  const raw = Math.pow(clamped, 1 / X_SOFTENING);
  return Math.round(Math.exp(raw * Math.log(COVERAGE_MAX_RANK)));
}
