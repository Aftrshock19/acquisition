"use client";

import type { Grade } from "@/lib/srs/types";
import type { UnifiedQueueCard } from "@/components/srs/logic/buildUnifiedQueue";

type NormalEsToEnCardProps = {
  card: Extract<
    UnifiedQueueCard,
    { cardType: "normal"; direction: "es_to_en" }
  >;
  busy: boolean;
  submitError: string | null;
  showPosHint?: boolean;
  revealed: boolean;
  onReveal: () => void;
  onGrade: (grade: Grade) => void;
};

export function NormalEsToEnCard({
  card,
  busy,
  submitError,
  showPosHint = true,
  revealed,
  onReveal,
  onGrade,
}: NormalEsToEnCardProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
          Word
        </p>
        <p className="mt-2 text-2xl font-semibold tracking-tight">{card.lemma}</p>
        {showPosHint && card.hint ? (
          <p className="mt-1 text-sm text-zinc-500">({card.hint})</p>
        ) : null}

        {revealed ? (
          <div className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
            <p className="text-xs uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
              Meaning
            </p>
            <p className="mt-2 text-lg font-medium">{card.definition ?? "—"}</p>
          </div>
        ) : null}

        {submitError ? (
          <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            {submitError}
          </p>
        ) : null}
      </div>

      {!revealed ? (
        <button
          type="button"
          onClick={onReveal}
          disabled={busy}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Show answer
        </button>
      ) : (
        <NormalGradeButtons busy={busy} onGrade={onGrade} />
      )}

      <p className="text-sm text-zinc-500">
        {!revealed
          ? "Reveal the answer, then choose a grade."
          : "Again repeats this card after the retry delay."}
      </p>
    </div>
  );
}

function NormalGradeButtons({
  busy,
  onGrade,
}: {
  busy: boolean;
  onGrade: (grade: Grade) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <GradeButton
        label="Again"
        className="border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-950/50"
        disabled={busy}
        onClick={() => onGrade("again")}
      />
      <GradeButton
        label="Hard"
        className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950/50"
        disabled={busy}
        onClick={() => onGrade("hard")}
      />
      <GradeButton
        label="Good"
        className="border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-200 dark:hover:bg-blue-950/50"
        disabled={busy}
        onClick={() => onGrade("good")}
      />
      <GradeButton
        label="Easy"
        className="border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-200 dark:hover:bg-green-950/50"
        disabled={busy}
        onClick={() => onGrade("easy")}
      />
    </div>
  );
}

function GradeButton({
  label,
  onClick,
  className,
  disabled,
}: {
  label: string;
  onClick: () => void;
  className: string;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${className}`}
    >
      {label}
    </button>
  );
}
