"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

import {
  getPlacementState,
  retakePlacementTest,
  skipPlacementRun,
  startPlacementRun,
  submitPlacementAnswer,
} from "@/app/actions/placement";
import type { PlacementState } from "@/lib/placement/state";
import type { AdaptivePlacementEstimate } from "@/lib/placement/types";

export function PlacementFlow({ initialState }: { initialState: PlacementState }) {
  const router = useRouter();
  const [state, setState] = useState<PlacementState>(initialState);
  const [isPending, startTransition] = useTransition();
  const [recallDraft, setRecallDraft] = useState("");
  const [promptStartedAt, setPromptStartedAt] = useState<number>(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [correctIndex, setCorrectIndex] = useState<number | null>(null);
  const [recallCorrect, setRecallCorrect] = useState(false);

  const refresh = useCallback(async () => {
    const next = await getPlacementState();
    if (next.ok) {
      setState(next.state);
      setRecallDraft("");
      setPromptStartedAt(Date.now());
    } else {
      setError(next.error);
    }
  }, []);

  // ── No run yet ────────────────────────────────────────
  if (state.status === "none" && !state.hasCompletedRun) {
    return (
      <IntroScreen
        isPending={isPending}
        bankEmpty={state.bankEmpty}
        error={error}
        onStart={() =>
          startTransition(async () => {
            setError(null);
            const res = await startPlacementRun();
            if (res.ok) setState(res.state);
            else setError(res.error);
          })
        }
        onSkip={() =>
          startTransition(async () => {
            await skipPlacementRun();
            router.push("/today");
          })
        }
      />
    );
  }

  // ── Completed (latest) ────────────────────────────────
  if (state.status === "none" && state.hasCompletedRun && state.completedEstimate) {
    return (
      <ResultScreen
        estimate={state.completedEstimate}
        onContinue={() => router.push("/today")}
        onRetake={() =>
          startTransition(async () => {
            const r = await retakePlacementTest();
            if (r.ok) {
              await refresh();
            } else {
              setError(r.error);
            }
          })
        }
      />
    );
  }

  // ── Just finished this run ────────────────────────────
  if (state.status === "completed" && state.estimate) {
    return (
      <ResultScreen
        estimate={state.estimate}
        onContinue={() => router.push("/today")}
        onRetake={() =>
          startTransition(async () => {
            const r = await retakePlacementTest();
            if (r.ok) await refresh();
          })
        }
      />
    );
  }

  // ── In progress ───────────────────────────────────────
  const item = state.currentItem;
  if (!item || !state.runId) {
    return (
      <main className="app-shell">
        <section className="app-hero">
          <h1 className="app-title">Find your starting point</h1>
        </section>
        <div className="app-card flex flex-col gap-4 p-6 md:p-8">
          {state.bankEmpty ? (
            <>
              <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                No placement items available
              </p>
              <p className="text-zinc-600 dark:text-zinc-400">
                The placement item bank is empty. Run{" "}
                <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">
                  npx tsx scripts/generate_placement_item_bank.ts --lang {state.language}
                </code>{" "}
                to seed it.
              </p>
            </>
          ) : (
            <p className="text-zinc-600 dark:text-zinc-400">Preparing your next item…</p>
          )}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="app-hero">
        <h1 className="app-title">Find your starting point</h1>
        <p className="app-subtitle">
          This short check helps us pick the right words and texts for you.
        </p>
      </section>

      <div className="app-card flex flex-col gap-6 p-6 md:p-8">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>
            Item {state.sequenceIndex + 1} of about {state.totalPlanned}
          </span>
          <span>
            {item.itemType === "recall" ? "Type the meaning" : "Choose the meaning"}
          </span>
        </div>

        {item.promptSentence ? (
          <p className="text-lg leading-relaxed text-zinc-800 dark:text-zinc-200">
            {highlightLemma(item.promptSentence, item.lemma)}
          </p>
        ) : null}

        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500">
            Target word
          </div>
          <div className="mt-1 text-3xl font-semibold text-zinc-950 dark:text-zinc-50">
            {item.lemma}
          </div>
        </div>

        {item.itemType === "recognition" && item.options ? (
          <RecognitionOptions
            options={item.options}
            disabled={isPending}
            correctIndex={correctIndex}
            onPick={(index) =>
              startTransition(async () => {
                setError(null);
                const latencyMs = Date.now() - promptStartedAt;
                const res = await submitPlacementAnswer({
                  runId: state.runId!,
                  itemBankId: item.id,
                  chosenOptionIndex: index,
                  usedIdk: false,
                  latencyMs,
                });
                if (res.ok) {
                  if (res.isCorrect) {
                    setCorrectIndex(index);
                    await new Promise((r) => setTimeout(r, 550));
                    setCorrectIndex(null);
                  }
                  setState(res.state);
                  setPromptStartedAt(Date.now());
                } else {
                  setError(res.error);
                }
              })
            }
            onIdk={() =>
              startTransition(async () => {
                setError(null);
                const latencyMs = Date.now() - promptStartedAt;
                const res = await submitPlacementAnswer({
                  runId: state.runId!,
                  itemBankId: item.id,
                  usedIdk: true,
                  latencyMs,
                });
                if (res.ok) {
                  setState(res.state);
                  setPromptStartedAt(Date.now());
                } else {
                  setError(res.error);
                }
              })
            }
          />
        ) : null}

        {item.itemType === "recall" ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const value = recallDraft;
              startTransition(async () => {
                setError(null);
                const latencyMs = Date.now() - promptStartedAt;
                const res = await submitPlacementAnswer({
                  runId: state.runId!,
                  itemBankId: item.id,
                  chosenText: value,
                  usedIdk: false,
                  latencyMs,
                });
                if (res.ok) {
                  if (res.isCorrect) {
                    setRecallCorrect(true);
                    await new Promise((r) => setTimeout(r, 550));
                    setRecallCorrect(false);
                  }
                  setState(res.state);
                  setRecallDraft("");
                  setPromptStartedAt(Date.now());
                } else {
                  setError(res.error);
                }
              });
            }}
          >
            <label className="text-sm text-zinc-600 dark:text-zinc-400">
              Type the English meaning (1–3 words)
            </label>
            <input
              autoFocus
              type="text"
              value={recallDraft}
              onChange={(e) => setRecallDraft(e.target.value)}
              disabled={isPending}
              className={
                recallCorrect
                  ? "app-input border-emerald-500 bg-emerald-50 text-emerald-900 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-100"
                  : "app-input"
              }
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="submit"
                disabled={isPending || recallDraft.trim().length === 0}
                className="app-button"
              >
                Continue
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const latencyMs = Date.now() - promptStartedAt;
                    const res = await submitPlacementAnswer({
                      runId: state.runId!,
                      itemBankId: item.id,
                      usedIdk: true,
                      latencyMs,
                    });
                    if (res.ok) {
                      setState(res.state);
                      setRecallDraft("");
                      setPromptStartedAt(Date.now());
                    } else {
                      setError(res.error);
                    }
                  })
                }
                className="app-button-secondary"
              >
                I don&apos;t know
              </button>
            </div>
          </form>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <DebugPanel state={state} />
      </div>
    </main>
  );
}

function DebugPanel({ state }: { state: PlacementState }) {
  const [open, setOpen] = useState(true);
  const item = state.currentItem;
  const plan = state.currentPlan;
  const est = state.estimate;
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="mt-2 rounded border border-dashed border-zinc-400 bg-zinc-50 p-3 text-xs font-mono text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
    >
      <summary className="cursor-pointer select-none font-sans text-[11px] uppercase tracking-wide text-zinc-500">
        debug
      </summary>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="text-zinc-500">run</span>
        <span className="truncate">{state.runId ?? "—"}</span>
        <span className="text-zinc-500">stage</span>
        <span>{plan?.stage ?? "—"}</span>
        <span className="text-zinc-500">seq</span>
        <span>
          {state.sequenceIndex} / ~{state.totalPlanned}
        </span>
        <span className="text-zinc-500">next cp</span>
        <span>{plan?.nextCheckpointIndex ?? "—"}</span>
        <span className="text-zinc-500">next type</span>
        <span>{plan?.nextItemType ?? "—"}</span>
        <span className="text-zinc-500">bracket</span>
        <span>
          [{plan?.bracketLowIndex ?? "—"}, {plan?.bracketHighIndex ?? "—"}]
        </span>
        <span className="text-zinc-500">item lemma</span>
        <span>{item?.lemma ?? "—"}</span>
        <span className="text-zinc-500">item rank</span>
        <span>{item?.frequencyRank ?? "—"}</span>
        <span className="text-zinc-500">item id</span>
        <span className="truncate">{item?.id ?? "—"}</span>
        <span className="text-zinc-500">floor rank</span>
        <span>{est?.confirmedFloorRank ?? "—"}</span>
        <span className="text-zinc-500">frontier</span>
        <span>
          {est?.estimatedFrontierRank ?? "—"} [{est?.frontierRankLow ?? "—"}–
          {est?.frontierRankHigh ?? "—"}]
        </span>
        <span className="text-zinc-500">status</span>
        <span>{est?.estimateStatus ?? "—"}</span>
        <span className="text-zinc-500">acc</span>
        <span>
          {est ? `${Math.round(est.rawAccuracy * 100)}%` : "—"}
        </span>
      </div>
      {plan?.reason ? (
        <div className="mt-2 text-[11px] text-zinc-500">{plan.reason}</div>
      ) : null}
    </details>
  );
}

function RecognitionOptions({
  options,
  disabled,
  correctIndex,
  onPick,
  onIdk,
}: {
  options: readonly string[];
  disabled: boolean;
  correctIndex: number | null;
  onPick: (index: number) => void;
  onIdk: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {options.map((opt, i) => {
        const isCorrect = correctIndex === i;
        return (
          <button
            key={`${i}-${opt}`}
            type="button"
            disabled={disabled}
            onClick={() => onPick(i)}
            className={
              isCorrect
                ? "app-link-card text-left text-lg !border-emerald-500 !bg-emerald-50 !text-emerald-900 dark:!bg-emerald-950/40 dark:!text-emerald-100"
                : "app-link-card text-left text-lg disabled:opacity-50"
            }
          >
            {opt}
          </button>
        );
      })}
      <button
        type="button"
        disabled={disabled}
        onClick={onIdk}
        className="mt-1 self-start rounded-lg px-2 py-2 text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        I don&apos;t know
      </button>
    </div>
  );
}

function IntroScreen({
  isPending,
  bankEmpty,
  error,
  onStart,
  onSkip,
}: {
  isPending: boolean;
  bankEmpty: boolean;
  error: string | null;
  onStart: () => void;
  onSkip: () => void;
}) {
  return (
    <main className="app-shell">
      <section className="app-hero">
        <h1 className="app-title">Find your starting point</h1>
        <p className="app-subtitle">
          A quick check so we can choose words, reading, and listening that
          feel right for you.
        </p>
      </section>

      <div className="app-card flex flex-col gap-6 p-6 md:p-8">
        <ul className="flex flex-col gap-3 text-[15px] text-zinc-700 dark:text-zinc-300">
          <ReassuranceRow>About 3 minutes</ReassuranceRow>
          <ReassuranceRow>You can choose &ldquo;I don&apos;t know&rdquo; at any time</ReassuranceRow>
          <ReassuranceRow>We&apos;ll keep adjusting as you learn</ReassuranceRow>
        </ul>

        {bankEmpty ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
            Setup needed. Run{" "}
            <code className="rounded bg-amber-200 px-1 dark:bg-amber-900/50">
              npx tsx scripts/generate_placement_item_bank.ts --lang es
            </code>
          </div>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            disabled={isPending || bankEmpty}
            onClick={onStart}
            className="app-button"
          >
            Start
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={onSkip}
            className="app-button-secondary"
          >
            Skip for now
          </button>
        </div>

        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          You can take this later in Settings.
        </p>
      </div>
    </main>
  );
}

function ReassuranceRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <CheckIcon />
      <span>{children}</span>
    </li>
  );
}

function CheckIcon() {
  return (
    <svg
      className="mt-0.5 h-4 w-4 flex-shrink-0 text-zinc-500 dark:text-zinc-500"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="4 10.5 8.5 15 16 6" />
    </svg>
  );
}

function ResultScreen({
  estimate,
  onContinue,
  onRetake,
}: {
  estimate: AdaptivePlacementEstimate;
  onContinue: () => void;
  onRetake: () => void;
}) {
  const {
    confirmedFloorRank,
    estimatedFrontierRank,
    frontierRankLow,
    frontierRankHigh,
    estimateStatus,
    topOfBankReached,
  } = estimate;

  const comfortLabel =
    confirmedFloorRank > 0
      ? `Up to about rank ${confirmedFloorRank.toLocaleString()}`
      : "Just getting started — we'll learn more as you go";

  let probeLabel: string;
  if (topOfBankReached) {
    probeLabel = "You cleared every checkpoint — we'll start at the highest band";
  } else if (confirmedFloorRank === 0) {
    probeLabel = `Rank 1–${frontierRankHigh.toLocaleString()}`;
  } else {
    probeLabel = `Rank ${frontierRankLow.toLocaleString()}–${frontierRankHigh.toLocaleString()}`;
  }

  const statusLabel = topOfBankReached
    ? "You cleared the top of our word bank"
    : statusToCopy(estimateStatus);

  const heroSubtitle = topOfBankReached
    ? "You cleared every checkpoint we tested. We'll start you near the top and keep adjusting."
    : confirmedFloorRank > 0
      ? `Based on your answers, we'll begin a little above rank ${confirmedFloorRank.toLocaleString()} and adjust quickly during your first few sessions.`
      : "We'll start gently and adjust as we learn more about you.";

  return (
    <main className="app-shell">
      <section className="app-hero">
        <h1 className="app-title">You&apos;re ready to start</h1>
        <p className="app-subtitle">{heroSubtitle}</p>
      </section>

      <div className="app-card flex flex-col gap-6 p-6 md:p-8">
        <dl className="flex flex-col gap-5">
          <ResultRow label="Confirmed comfort zone" value={comfortLabel} />
          <ResultRow label="Next probe range" value={probeLabel} />
          <ResultRow label="Estimate status" value={statusLabel} />
        </dl>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button type="button" onClick={onContinue} className="app-button">
            Continue to today
          </button>
          <button
            type="button"
            onClick={onRetake}
            className="app-button-secondary"
          >
            Retake diagnostic
          </button>
        </div>

        <Link
          href="/settings"
          className="self-start text-xs text-zinc-500 underline underline-offset-4 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300"
        >
          Settings
        </Link>
      </div>
    </main>
  );
}

function statusToCopy(status: AdaptivePlacementEstimate["estimateStatus"]): string {
  switch (status) {
    case "early":
      return "Early — based on just a few items";
    case "provisional":
      return "Provisional, based on a short diagnostic";
    case "medium":
      return "Reasonably confident — we narrowed it down";
    case "high":
      return "High confidence — narrow bracket reached";
  }
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-l-2 border-zinc-200 pl-4 dark:border-zinc-800">
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="text-base text-zinc-900 dark:text-zinc-100">{value}</dd>
    </div>
  );
}

function highlightLemma(sentence: string, lemma: string): React.ReactNode {
  const idx = sentence.toLowerCase().indexOf(lemma.toLowerCase());
  if (idx < 0) return sentence;
  return (
    <>
      {sentence.slice(0, idx)}
      <strong className="font-semibold">{sentence.slice(idx, idx + lemma.length)}</strong>
      {sentence.slice(idx + lemma.length)}
    </>
  );
}
