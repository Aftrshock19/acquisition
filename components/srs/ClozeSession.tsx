"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { BackButton } from "@/components/BackButton";
import { SettingsButton } from "@/components/SettingsButton";

export type ClozeCard = {
  id: string;
  kind: "review" | "new";
  lemma: string;
  definition: string | null;
  hint?: string | null;
  extra?: unknown;
};

type RetryEntry = { card: ClozeCard; dueAt: number };

export type ClozeSessionProps = {
  cards: ClozeCard[];
  dailyLimit: number;
  onReview: (
    cardId: string,
    correct: boolean,
    msSpent: number,
    userAnswer: string,
    expected: string[],
  ) => void | Promise<void>;
  onComplete?: () => void;
  retryDelayMs?: number;
  ignoreAccents?: boolean;
  ignorePunctuation?: boolean;
};

function stripDiacritics(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalize(
  s: string,
  opts: { ignoreAccents: boolean; ignorePunctuation: boolean },
): string {
  let x = s.trim().toLowerCase().replace(/\s+/g, " ");
  if (opts.ignorePunctuation)
    x = x.replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~¿¡]/g, "");
  if (opts.ignoreAccents) x = stripDiacritics(x);
  return x;
}

function checkCorrect(
  userAnswer: string,
  expected: string[],
  opts: { ignoreAccents: boolean; ignorePunctuation: boolean },
): boolean {
  const u = normalize(userAnswer, opts);
  if (!u) return false;
  return expected.some((e) => normalize(e, opts) === u);
}

function upsertRetrySorted(list: RetryEntry[], entry: RetryEntry) {
  const filtered = list.filter((x) => x.card.id !== entry.card.id);
  const idx = filtered.findIndex((x) => x.dueAt > entry.dueAt);
  if (idx === -1) return [...filtered, entry];
  return [...filtered.slice(0, idx), entry, ...filtered.slice(idx)];
}

export function ClozeSession({
  cards,
  dailyLimit,
  onReview,
  onComplete,
  retryDelayMs = 90000,
  ignoreAccents = true,
  ignorePunctuation = true,
}: ClozeSessionProps) {
  const displayCards = useMemo(() => cards.slice(0, dailyLimit), [cards, dailyLimit]);

  const [mainIndex, setMainIndex] = useState(0);
  const [retryList, setRetryList] = useState<RetryEntry[]>([]);
  const [current, setCurrent] = useState<ClozeCard | null>(
    displayCards.length > 0 ? displayCards[0] : null,
  );
  const [phase, setPhase] = useState<"answer" | "feedback" | "waiting" | "done">(
    displayCards.length > 0 ? "answer" : "done",
  );

  const [feedbackCorrect, setFeedbackCorrect] = useState(false);
  const [feedbackExpected, setFeedbackExpected] = useState("");
  const [userInput, setUserInput] = useState("");
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [busy, setBusy] = useState(false);

  const startedAtRef = useRef<number>(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMainIndex(0);
    setRetryList([]);
    setCurrent(displayCards.length > 0 ? displayCards[0] : null);
    setPhase(displayCards.length > 0 ? "answer" : "done");
    setFeedbackCorrect(false);
    setFeedbackExpected("");
    setUserInput("");
    setWaitSeconds(0);
    setBusy(false);
    startedAtRef.current = Date.now();
  }, [displayCards]);

  useEffect(() => {
    if (current && phase === "answer") {
      startedAtRef.current = Date.now();
      setUserInput("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [current, phase]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (busy) return;
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (phase === "answer") void handleCheck();
      else if (phase === "feedback") void handleNext();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, busy, userInput, current, retryList, mainIndex]);

  useEffect(() => {
    if (phase !== "waiting" || retryList.length === 0) return;

    const tick = () => {
      const dueAt = retryList[0].dueAt;
      const secs = Math.max(0, Math.ceil((dueAt - Date.now()) / 1000));
      setWaitSeconds(secs);

      if (secs <= 0) {
        const entry = retryList[0];
        setRetryList((q) => q.slice(1));
        setCurrent(entry.card);
        setPhase("answer");
      }
    };

    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [phase, retryList]);

  async function handleCheck() {
    if (!current || phase !== "answer" || busy) return;

    const userAnswer = userInput.trim();
    if (!userAnswer) return;

    const expected = [current.lemma];
    const correct = checkCorrect(userAnswer, expected, {
      ignoreAccents,
      ignorePunctuation,
    });
    const msSpent = Date.now() - startedAtRef.current;

    setBusy(true);
    try {
      await onReview(current.id, correct, msSpent, userAnswer, expected);

      setFeedbackCorrect(correct);
      setFeedbackExpected(current.lemma);
      setPhase("feedback");

      if (!correct) {
        setRetryList((q) =>
          upsertRetrySorted(q, { card: current, dueAt: Date.now() + retryDelayMs }),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleNext() {
    if (phase !== "feedback" || busy) return;

    const now = Date.now();

    const dueRetry = retryList.length > 0 && retryList[0].dueAt <= now ? retryList[0] : null;
    if (dueRetry) {
      setRetryList((q) => q.slice(1));
      setCurrent(dueRetry.card);
      setPhase("answer");
      return;
    }

    const nextMain = mainIndex + 1;
    if (nextMain < displayCards.length) {
      setMainIndex(nextMain);
      setCurrent(displayCards[nextMain]);
      setPhase("answer");
      return;
    }

    if (retryList.length > 0) {
      setCurrent(null);
      setPhase("waiting");
      return;
    }

    setCurrent(null);
    setPhase("done");
    onComplete?.();
  }

  const totalCards = displayCards.length;
  const completedCount =
    phase === "answer" ? mainIndex : Math.min(mainIndex + 1, totalCards);
  const progressPercent = totalCards > 0 ? (100 * completedCount) / totalCards : 0;

  function SessionProgressBar() {
    return (
      <div className="flex items-start gap-3">
        <BackButton className="shrink-0" />

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex justify-between text-sm text-zinc-500 dark:text-zinc-400">
            <span>
              Card {completedCount} of {totalCards}
            </span>
            <span>{Math.round(progressPercent)}%</span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"
            role="progressbar"
            aria-valuenow={completedCount}
            aria-valuemin={0}
            aria-valuemax={totalCards}
          >
            <div
              className="h-full rounded-full bg-zinc-700 transition-[width] duration-300 ease-out dark:bg-zinc-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <SettingsButton className="shrink-0" />
      </div>
    );
  }

  if (displayCards.length === 0) {
    return <p className="text-zinc-600 dark:text-zinc-400">No cards in this session.</p>;
  }

  if (phase === "done") {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-zinc-50 p-8 dark:border-zinc-800 dark:bg-zinc-900/50">
        <h2 className="text-xl font-semibold tracking-tight">Session complete</h2>
        <p className="text-zinc-600 dark:text-zinc-400">
          You’re done for now. Come back tomorrow for more.
        </p>
      </div>
    );
  }

  if (phase === "waiting") {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-zinc-50 p-8 dark:border-zinc-800 dark:bg-zinc-900/50">
        <SessionProgressBar />
        <h2 className="text-xl font-semibold tracking-tight">Quick pause</h2>
        <p className="text-zinc-600 dark:text-zinc-400">Next retry in {waitSeconds}s</p>
      </div>
    );
  }

  if (phase === "feedback") {
    return (
      <div className="flex flex-col gap-6">
        <SessionProgressBar />
        <div
          className={`rounded-xl border p-6 ${
            feedbackCorrect
              ? "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/40"
              : "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40"
          }`}
        >
          <p className="font-medium">{feedbackCorrect ? "Correct" : "Incorrect"}</p>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">Expected: {feedbackExpected}</p>
          {!feedbackCorrect ? (
            <p className="mt-1 text-sm text-zinc-500">
              Will repeat in {Math.max(1, Math.round(retryDelayMs / 1000))}s
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => void handleNext()}
          disabled={busy}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Next
        </button>

        <p className="text-sm text-zinc-500">Press Enter to continue</p>
      </div>
    );
  }

  if (!current) return null;

  const prompt = current.definition ?? "—";

  return (
    <div className="flex flex-col gap-6">
      <SessionProgressBar />
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-zinc-600 dark:text-zinc-400">{prompt}</p>
        {current.hint ? <p className="mt-1 text-sm text-zinc-500">({current.hint})</p> : null}

        <input
          ref={inputRef}
          type="text"
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          placeholder="Type the word…"
          className="mt-4 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          autoComplete="off"
          disabled={busy}
        />
      </div>

      <button
        type="button"
        onClick={() => void handleCheck()}
        disabled={busy || !userInput.trim()}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Check
      </button>

      <p className="text-sm text-zinc-500">Press Enter to check</p>
    </div>
  );
}
