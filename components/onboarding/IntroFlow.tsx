"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  completeOnboardingAsBeginner,
  completeOnboardingAsSelfCertified,
  startOnboardingAsBaseline,
} from "@/app/actions/onboarding";
import { CEFR_OPTIONS, type CefrLevel } from "@/lib/onboarding/cefr";
import {
  INTRO_PAGE_COUNT,
  introNavReduce,
  introNavState,
  startBranchReduce,
  startBranchCanGoBack,
  type StartBranchStep,
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
   * final branching "How do you want to start?" page. Used by the profile
   * page so users can revisit the intro without going through the
   * beginner / baseline / self-certify fork again.
   */
  replay?: boolean;
};

export function IntroFlow({ initialPage = 0, replay = false }: IntroFlowProps) {
  const router = useRouter();
  const linearLastPage = INTRO_PAGE_COUNT - 2; // index of last linear screen
  const [page, setPage] = useState(
    Math.min(initialPage, replay ? linearLastPage : INTRO_PAGE_COUNT - 1),
  );
  const [branch, setBranch] = useState<StartBranchStep>({
    kind: "ask_experience",
  });
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const nav = introNavState(page);
  const onFinalPage = !replay && nav.isLast;
  const onReplayLast = replay && page === linearLastPage;
  const effectiveTotal = replay ? INTRO_PAGE_COUNT - 1 : INTRO_PAGE_COUNT;

  const goNext = () => {
    if (onReplayLast) {
      router.push("/profile");
      return;
    }
    setPage((p) => introNavReduce(p, "next"));
  };
  const goBack = () => {
    if (onFinalPage && startBranchCanGoBack(branch)) {
      setBranch((b) => startBranchReduce(b, { kind: "back" }));
      return;
    }
    setPage((p) => introNavReduce(p, "back"));
  };

  const answerYes = () =>
    setBranch((b) =>
      startBranchReduce(b, { kind: "answer_experience", hasExperience: true }),
    );

  const answerNo = () => {
    startTransition(async () => {
      setError(null);
      const res = await completeOnboardingAsBeginner();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push("/");
    });
  };

  const chooseBaseline = () => {
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

  const chooseSelfCertify = () =>
    setBranch((b) => startBranchReduce(b, { kind: "choose_self_certify" }));

  const pickCefr = (level: CefrLevel) => {
    startTransition(async () => {
      setError(null);
      const res = await completeOnboardingAsSelfCertified(level);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push("/");
    });
  };

  const canGoBack = onFinalPage
    ? nav.canGoBack || startBranchCanGoBack(branch)
    : nav.canGoBack;

  return (
    <main className="app-shell" data-testid="intro-flow">
      <section className="app-hero">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
          Welcome
        </p>
        <ProgressLabel page={page} total={effectiveTotal} />
      </section>

      <div className="app-card flex flex-col gap-8 p-6 md:p-8">
        {page === 0 ? <WelcomePage /> : null}
        {page === 1 ? <HowAcquiredPage /> : null}
        {page === 2 ? <WhyInputHardPage /> : null}
        {page === 3 ? <PuzzlePiecesPage /> : null}
        {page === 4 ? <FrequencyGraphPage /> : null}
        {page === 5 ? <DailyLoopWhyPage /> : null}
        {page === 6 ? <AdaptiveDifferencePage /> : null}
        {page === 7 && !replay ? (
          <StartBranch
            step={branch}
            isPending={isPending}
            onAnswerYes={answerYes}
            onAnswerNo={answerNo}
            onChooseBaseline={chooseBaseline}
            onChooseSelfCertify={chooseSelfCertify}
            onPickCefr={pickCefr}
          />
        ) : null}

        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {canGoBack ? (
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

          {!onFinalPage ? (
            <button
              type="button"
              onClick={goNext}
              disabled={isPending}
              className="app-button"
              data-testid="intro-next"
            >
              {onReplayLast ? "Done" : "Next"}
            </button>
          ) : null}
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

/* ─── Screen 1 ────────────────────────────────────────────────────────── */
function WelcomePage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="app-title">Welcome to Acquisition</h1>
      <p className="text-lg leading-relaxed text-zinc-700 dark:text-zinc-300">
        A calmer way to acquire Spanish through vocabulary, reading, and
        listening.
      </p>
      <p className="text-base text-zinc-600 dark:text-zinc-400">
        You don&apos;t need to be perfect. The app helps keep things at the
        right level so you can keep coming back.
      </p>
    </div>
  );
}

/* ─── Screen 2 ────────────────────────────────────────────────────────── */
function HowAcquiredPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="app-title">Languages are acquired through input</h1>
      <p className="text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
        That means reading and listening your brain can gradually make sense
        of. The more understandable Spanish you meet, the more your internal
        model of the language grows.
      </p>
      <div
        aria-hidden="true"
        className="grid grid-cols-2 gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-center dark:border-zinc-800 dark:bg-zinc-900/40"
      >
        <div className="flex flex-col gap-1">
          <span className="text-2xl">📖</span>
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Reading
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-2xl">🎧</span>
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Listening
          </span>
        </div>
      </div>
      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        Reading and listening are the long-term engine.
      </p>
    </div>
  );
}

/* ─── Screen 3 ────────────────────────────────────────────────────────── */
function WhyInputHardPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="app-title">Real Spanish is hard when too much is unknown</h1>
      <p className="text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
        If nearly every sentence has too many missing pieces, your brain has
        very little to build from.
      </p>
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 leading-loose text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-500">
        <p>
          <BlurSpan>Cuando</BlurSpan> the <BlurSpan>palabras</BlurSpan> are{" "}
          <BlurSpan>desconocidas</BlurSpan>, the <BlurSpan>mente</BlurSpan>{" "}
          has <BlurSpan>nada</BlurSpan> to{" "}
          <BlurSpan>reconstruir</BlurSpan>.
        </p>
      </div>
      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        Give it a few anchor words and the same sentence becomes workable.
      </p>
    </div>
  );
}

function BlurSpan({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-zinc-300/60 px-1 text-transparent dark:bg-zinc-700/60">
      {children}
    </span>
  );
}

/* ─── Screen 4 ────────────────────────────────────────────────────────── */
function PuzzlePiecesPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="app-title">So we start with a few useful puzzle pieces</h1>
      <div className="flex flex-col gap-3">
        <StepLine
          n={1}
          title="Memorize a few common words"
          body="A small, very useful set — your anchor points."
        />
        <StepLine
          n={2}
          title="Meet them again in reading and listening"
          body="Same words, in context, at your level."
        />
        <StepLine
          n={3}
          title="Your brain connects patterns"
          body="Even before you understand everything, the pieces start fitting together."
        />
      </div>
      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        Memorization isn&apos;t the point. It&apos;s support for the real
        work: understanding input.
      </p>
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

/* ─── Screen 5 ────────────────────────────────────────────────────────── */
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
        Estimated from the app&apos;s own reading content: for each bucket, we
        count what share of running words in a typical passage you&apos;d
        recognise if you knew the top-N most common words. It&apos;s a rough
        guide to how much text starts to open up — not an exact comprehension
        score, and every text is a little different.
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

/* ─── Screen 6 ────────────────────────────────────────────────────────── */
function DailyLoopWhyPage() {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="app-title">Why this order: memorize → read → listen</h1>
      <ol className="flex flex-col gap-3">
        <LoopRow
          index={1}
          title="Memorize"
          body="Cards give you the pieces — a fast, focused pretraining pass on useful words."
        />
        <LoopRow
          index={2}
          title="Read"
          body="Reading lets you reuse those words in stable, visible context."
        />
        <LoopRow
          index={3}
          title="Listen"
          body="Listening helps you recognize the same words in real-time — the harder, faster form."
        />
      </ol>
      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        Together, this creates a better environment for acquisition than any
        one activity alone.
      </p>
    </div>
  );
}

function LoopRow({
  index,
  title,
  body,
}: {
  index: number;
  title: string;
  body: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-xs font-semibold text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
        {index}
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </span>
        <span className="text-sm text-zinc-600 dark:text-zinc-400">{body}</span>
      </div>
    </li>
  );
}

/* ─── Screen 7 ────────────────────────────────────────────────────────── */
function AdaptiveDifferencePage() {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="app-title">Acquisition adapts to you</h1>
      <p className="text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
        It starts with a best estimate of where you are, then keeps adjusting
        so your Spanish stays challenging enough to help, but not so hard it
        becomes discouraging.
      </p>
      <DifficultyBand />
      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        A starting estimate, a projected current zone, and steady
        recalibration — not a fixed label.
      </p>
    </div>
  );
}

function DifficultyBand() {
  return (
    <div className="flex flex-col gap-2">
      <div
        className="relative grid grid-cols-3 overflow-hidden rounded-xl border border-zinc-200 text-center text-xs font-medium dark:border-zinc-800"
        role="img"
        aria-label="Difficulty bands: too easy, best growth zone, too hard"
      >
        <div className="bg-zinc-100 py-3 text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-400">
          Too easy
        </div>
        <div className="bg-zinc-900 py-3 text-white dark:bg-zinc-100 dark:text-zinc-900">
          Best growth zone
        </div>
        <div className="bg-zinc-100 py-3 text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-400">
          Too hard
        </div>
      </div>
      <div className="flex justify-center">
        <span className="text-[10px] uppercase tracking-widest text-zinc-500">
          ↑ that&apos;s where we try to keep you
        </span>
      </div>
    </div>
  );
}

/* ─── Screen 8 — branching ────────────────────────────────────────────── */
function StartBranch({
  step,
  isPending,
  onAnswerYes,
  onAnswerNo,
  onChooseBaseline,
  onChooseSelfCertify,
  onPickCefr,
}: {
  step: StartBranchStep;
  isPending: boolean;
  onAnswerYes: () => void;
  onAnswerNo: () => void;
  onChooseBaseline: () => void;
  onChooseSelfCertify: () => void;
  onPickCefr: (level: CefrLevel) => void;
}) {
  if (step.kind === "ask_experience") {
    return (
      <div
        className="flex flex-col gap-5"
        data-testid="intro-branch-ask-experience"
      >
        <h1 className="app-title">Choose where to begin</h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Do you already have some Spanish experience? No right answer — we
          just want to start you in the right place.
        </p>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={onAnswerYes}
            disabled={isPending}
            className="app-link-card text-left"
            data-testid="intro-answer-yes"
          >
            <span className="block text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Yes, I know some Spanish
            </span>
            <span className="mt-1 block text-sm text-zinc-600 dark:text-zinc-400">
              We&apos;ll help you find a good starting level.
            </span>
          </button>
          <button
            type="button"
            onClick={onAnswerNo}
            disabled={isPending}
            className="app-link-card text-left"
            data-testid="intro-answer-no"
          >
            <span className="block text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              No, I&apos;m new to Spanish
            </span>
            <span className="mt-1 block text-sm text-zinc-600 dark:text-zinc-400">
              We&apos;ll start from the very beginning. No test needed.
            </span>
          </button>
        </div>
      </div>
    );
  }

  if (step.kind === "pick_path") {
    return (
      <div className="flex flex-col gap-5" data-testid="intro-branch-pick-path">
        <h1 className="app-title">How would you like to start?</h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          A short check gives the best starting point. You can also pick a
          level yourself if you prefer.
        </p>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={onChooseBaseline}
            disabled={isPending}
            className="app-button w-full justify-center py-4 text-left sm:py-4"
            data-testid="intro-choose-baseline"
          >
            <span className="flex flex-col gap-1">
              <span className="text-lg font-semibold">
                {isPending ? "Starting…" : "Take quick placement"}
              </span>
              <span className="text-sm font-normal opacity-90">
                Recommended. Gives you a better starting point in a few
                minutes.
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={onChooseSelfCertify}
            disabled={isPending}
            className="self-start text-sm text-zinc-600 underline underline-offset-4 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-100"
            data-testid="intro-choose-self-certify"
          >
            Choose my own level instead — pick a starting level yourself. The
            app can still adjust as you use it.
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5" data-testid="intro-branch-pick-cefr">
      <h1 className="app-title">Pick a starting level</h1>
      <p className="text-base text-zinc-600 dark:text-zinc-400">
        Choose whichever description sounds closest. The app keeps adjusting
        as you use it, so this is only a starting point.
      </p>
      <ul className="flex flex-col gap-3">
        {CEFR_OPTIONS.map((option) => (
          <li key={option.level}>
            <button
              type="button"
              disabled={isPending}
              onClick={() => onPickCefr(option.level)}
              className="app-link-card w-full text-left"
              data-testid={`intro-cefr-${option.level}`}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {option.label}
                </span>
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
                  {option.level}
                </span>
              </span>
              <span className="mt-1 block text-sm text-zinc-600 dark:text-zinc-400">
                {option.canDo}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
