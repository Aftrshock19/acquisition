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
  type CoveragePoint,
} from "./coverageData";

export const TOP_N_BUCKETS = [100, 500, 1000, 2000, 5000] as const;
export type TopNBucket = (typeof TOP_N_BUCKETS)[number];

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
  100: "These very common words already unlock a noticeable part of simple Spanish.",
  500: "With 500 common words, a lot more of everyday text starts to look familiar.",
  1000: "At around 1,000 common words, you start recognising something in almost every sentence.",
  2000: "By 2,000, many everyday texts feel much more followable, even with some gaps.",
  5000: "By 5,000, you can recognise a large share of typical text — but each extra word adds less than the early ones did.",
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
 * Samples along the estimated-coverage curve for SVG rendering, taken from
 * the precomputed build-time dataset. X is log-scaled rank in [0,1]; Y is
 * estimated text coverage in [0,1]. Monotone non-decreasing on both axes.
 * If the caller asks for a different sample count than the stored curve,
 * we resample by linear interpolation on x.
 */
export function coverageCurveSamples(
  sampleCount = COVERAGE_CURVE.length,
): CoveragePoint[] {
  if (sampleCount < 2) sampleCount = 2;
  if (sampleCount === COVERAGE_CURVE.length) {
    return COVERAGE_CURVE.map((p) => ({ x: p.x, y: p.y }));
  }
  const out: CoveragePoint[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = i / (sampleCount - 1);
    out.push({ x: t, y: interpolateCurveY(t) });
  }
  return out;
}

function interpolateCurveY(x: number): number {
  if (x <= COVERAGE_CURVE[0].x) return COVERAGE_CURVE[0].y;
  const last = COVERAGE_CURVE[COVERAGE_CURVE.length - 1];
  if (x >= last.x) return last.y;
  for (let i = 1; i < COVERAGE_CURVE.length; i++) {
    const a = COVERAGE_CURVE[i - 1];
    const b = COVERAGE_CURVE[i];
    if (x <= b.x) {
      const span = b.x - a.x;
      const t = span <= 0 ? 0 : (x - a.x) / span;
      return a.y + t * (b.y - a.y);
    }
  }
  return last.y;
}

/**
 * Where (on 0..1) the selected bucket sits along the log-scaled x-axis.
 * Matches the x-coordinate used when sampling the curve so the marker
 * lands exactly on it.
 */
export function bucketXPosition(bucket: TopNBucket): number {
  return Math.log(bucket) / Math.log(COVERAGE_MAX_RANK);
}
