"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { startOnboardingAsBaseline } from "@/app/actions/onboarding";
import {
  INTRO_PAGE_COUNT,
  introNavReduce,
  introNavState,
} from "@/lib/onboarding/introNavigation";
import {
  COVERAGE_MAX_RANK,
  TOP_N_BUCKETS,
  coverageCurveSamples,
  coverageFractionForTopN,
  topNFromXPosition,
  topNGraphState,
  topNXPosition,
} from "@/lib/onboarding/coverageGraph";

export { INTRO_PAGE_COUNT };

export type IntroFlowProps = {
  initialPage?: number;
  /**
   * Replay mode: walks the linear explanatory screens only and skips the
   * final placement-start page. Used by the profile page so users can
   * revisit the intro without re-entering the placement / level-pick fork.
   */
  replay?: boolean;
};

export function IntroFlow({ initialPage = 0, replay = false }: IntroFlowProps) {
  const router = useRouter();
  // Every screen is now explanatory (the placement-launch step was folded
  // into the final-page Next button), so replay walks the full carousel.
  const lastPage = INTRO_PAGE_COUNT - 1;
  const [page, setPage] = useState(Math.min(initialPage, lastPage));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const nav = introNavState(page);
  const onFinalPage = !replay && nav.isLast;
  const onReplayLast = replay && nav.isLast;
  const effectiveTotal = INTRO_PAGE_COUNT;

  const goNext = () => {
    if (onReplayLast) {
      router.push("/profile");
      return;
    }
    setPage((p) => introNavReduce(p, "next"));
  };
  const goBack = () => setPage((p) => introNavReduce(p, "back"));

  const startPlacement = () => {
    startTransition(async () => {
      setError(null);
      const res = await startOnboardingAsBaseline();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push("/placement");
    });
  };

  return (
    <main className="app-shell" data-testid="intro-flow">
      <section className="app-hero">
        <ProgressLabel page={page} total={effectiveTotal} />
      </section>

      <div className="app-card flex flex-col gap-8 p-6 md:p-8">
        {page === 0 ? <WhatIsThisPage /> : null}
        {page === 1 ? <HowItWorksPage /> : null}
        {page === 2 ? <AdaptsToYouPage /> : null}
        {page === 3 ? <FrequencyGraphPage /> : null}

        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {nav.canGoBack ? (
            <button
              type="button"
              onClick={goBack}
              disabled={isPending}
              className="app-button-secondary"
              data-testid="intro-back"
            >
              Back
            </button>
          ) : (
            <span />
          )}

          <button
            type="button"
            onClick={onFinalPage ? startPlacement : goNext}
            disabled={isPending}
            className="app-button"
            data-testid="intro-next"
          >
            {onReplayLast
              ? "Done"
              : onFinalPage && isPending
                ? "Starting…"
                : "Next"}
          </button>
        </div>
      </div>
    </main>
  );
}

function ProgressLabel({ page, total }: { page: number; total: number }) {
  return (
    <p
      className="app-subtitle"
      data-testid="intro-progress"
      aria-label={`Step ${page + 1} of ${total}`}
    >
      Step {page + 1} of {total}
    </p>
  );
}

/* ─── Screen 0 ────────────────────────────────────────────────────────── */
function WhatIsThisPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="app-title">Learn Spanish through reading and listening</h1>
      <p className="text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
        Short daily sessions. Vocabulary first, then practice in context.
      </p>
    </div>
  );
}

/* ─── Screen 1 ────────────────────────────────────────────────────────── */
function HowItWorksPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="app-title">Your daily session</h1>
      <div className="flex flex-col gap-3">
        <StepLine
          n={1}
          title="Flashcards"
          body="Meet new words. You're not expected to know them yet."
        />
        <StepLine
          n={2}
          title="Reading"
          body="See them again in a short passage at your level."
        />
        <StepLine
          n={3}
          title="Listening"
          body="Hear them spoken naturally."
        />
      </div>
    </div>
  );
}

function StepLine({
  n,
  title,
  body,
}: {
  n: number;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
        {n}
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </span>
        <span className="text-sm text-zinc-600 dark:text-zinc-400">{body}</span>
      </div>
    </div>
  );
}

/* ─── Screen 2 ────────────────────────────────────────────────────────── */
function AdaptsToYouPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="app-title">The app adjusts to you</h1>
      <p className="text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
        Start wherever you are.
      </p>
      <p className="text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
        Sessions stay short.
      </p>
      <p className="text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
        Difficulty adapts as you go.
      </p>
    </div>
  );
}

/* ─── Screen 3 ────────────────────────────────────────────────────────── */
const SLIDER_STEPS = 1000;

function FrequencyGraphPage() {
  const [topN, setTopN] = useState<number>(500);
  const state = topNGraphState(topN);
  const sliderValue = Math.round(topNXPosition(topN) * SLIDER_STEPS);
  return (
    <div className="flex flex-col gap-5" data-testid="intro-frequency-page">
      <h1 className="app-title">How much text opens up as you learn more words</h1>
      <p className="text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
        A small set of very common words does most of the work in real Spanish
        — so learning them first lets you recognise far more of a typical text,
        far sooner.
      </p>

      <CoverageSvg topN={topN} />

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <label
            htmlFor="intro-freq-slider"
            className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Common words you know
          </label>
          <span className="text-sm tabular-nums text-zinc-900 dark:text-zinc-100">
            Top {topN.toLocaleString()}
          </span>
        </div>
        <input
          id="intro-freq-slider"
          type="range"
          min={0}
          max={SLIDER_STEPS}
          step={1}
          value={sliderValue}
          onChange={(e) =>
            setTopN(topNFromXPosition(Number(e.target.value) / SLIDER_STEPS))
          }
          aria-label="How many common words you know"
          aria-valuemin={1}
          aria-valuemax={COVERAGE_MAX_RANK}
          aria-valuenow={topN}
          aria-valuetext={`Top ${topN.toLocaleString()}`}
          className="w-full accent-zinc-900 dark:accent-zinc-100"
          data-testid="intro-freq-slider"
        />
        <div className="relative h-3 px-0.5 text-[10px] tabular-nums text-zinc-500">
          {TOP_N_BUCKETS.map((b) => {
            const leftPct = topNXPosition(b) * 100;
            return (
              <span
                key={b}
                className="absolute -translate-x-1/2"
                style={{ left: `${leftPct}%` }}
              >
                {b.toLocaleString()}
              </span>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            ~{state.coveragePercent}%
          </span>
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            estimated word recognition in a typical text
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {state.caption}
        </p>
      </div>

      <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
        Based on word frequency in the app&apos;s reading content.
      </p>
    </div>
  );
}

function CoverageSvg({ topN }: { topN: number }) {
  const width = 520;
  const height = 200;
  const padX = 32;
  const padTop = 14;
  const padBottom = 28;
  const samples = coverageCurveSamples(80);
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;

  const project = (x: number, y: number) => ({
    px: padX + x * innerW,
    py: padTop + (1 - y) * innerH,
  });

  const points = samples
    .map((s) => {
      const { px, py } = project(s.x, s.y);
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(" ");

  const { px: markerX, py: markerY } = project(
    topNXPosition(topN),
    coverageFractionForTopN(topN),
  );
  const baselineY = padTop + innerH;
  const gridYs = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block h-auto w-full"
        role="img"
        aria-label={`Estimated text coverage from knowing the top ${topN.toLocaleString()} most common words: about ${Math.round(
          coverageFractionForTopN(topN) * 100,
        )} percent`}
      >
        <defs>
          <linearGradient id="coverageFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="text-zinc-800 dark:text-zinc-200">
          {gridYs.map((gy) => {
            const y = padTop + (1 - gy) * innerH;
            return (
              <g key={gy}>
                <line
                  x1={padX}
                  x2={width - padX}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  strokeWidth="0.5"
                  opacity="0.15"
                />
                <text
                  x={padX - 4}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-zinc-500"
                  fontSize="8"
                >
                  {Math.round(gy * 100)}%
                </text>
              </g>
            );
          })}

          <polygon
            points={`${padX},${baselineY} ${points} ${width - padX},${baselineY}`}
            fill="url(#coverageFill)"
          />
          <polyline
            points={points}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          <line
            x1={markerX}
            x2={markerX}
            y1={markerY}
            y2={baselineY}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="4 3"
            opacity="0.5"
          />
          <circle cx={markerX} cy={markerY} r="4.5" fill="currentColor" />
        </g>

        <text
          x={padX}
          y={height - 6}
          className="fill-zinc-500"
          fontSize="9"
        >
          Fewer common words
        </text>
        <text
          x={width - padX}
          y={height - 6}
          textAnchor="end"
          className="fill-zinc-500"
          fontSize="9"
        >
          More common words →
        </text>
      </svg>
    </div>
  );
}
