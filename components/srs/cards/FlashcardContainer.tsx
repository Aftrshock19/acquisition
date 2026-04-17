"use client";

import type { ReactNode } from "react";

type FlashcardContainerProps = {
  typeLabel?: ReactNode;
  title: ReactNode;
  navigation?: ReactNode;
  children: ReactNode;
};

export function FlashcardContainer({
  typeLabel,
  title,
  navigation,
  children,
}: FlashcardContainerProps) {
  const showSecondaryTitle =
    !typeLabel ||
    typeof typeLabel !== "string" ||
    typeof title !== "string" ||
    typeLabel.trim().toLowerCase() !== title.trim().toLowerCase();

  return (
    <section className="relative min-w-0 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      {navigation ? <div className="absolute inset-x-6 top-6">{navigation}</div> : null}
      <div className="flex min-h-9 flex-col items-center justify-center gap-1 px-12 text-center">
        <p className="text-sm uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
          {typeLabel ?? title}
        </p>
        {showSecondaryTitle ? (
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">
            {title}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

type FlashcardTone = "default" | "success" | "error";

export function getFlashcardFieldToneClasses(tone: FlashcardTone) {
  if (tone === "success") {
    return "border border-emerald-400 bg-emerald-50 placeholder:text-emerald-500 focus:border-emerald-500 focus:ring-emerald-500 dark:border-emerald-700 dark:bg-emerald-950/40 dark:placeholder:text-emerald-300";
  }

  if (tone === "error") {
    return "border border-rose-200 bg-rose-50/50 placeholder:text-rose-300 focus:border-rose-300 focus:ring-rose-300 dark:border-rose-900/70 dark:bg-rose-950/20 dark:placeholder:text-rose-400";
  }

  return "border border-zinc-300 bg-white focus:border-zinc-500 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:placeholder:text-zinc-500";
}

export function FlashcardFeedbackPanel({
  tone,
  title,
  detail,
  secondary,
}: {
  tone: Exclude<FlashcardTone, "default">;
  title: ReactNode;
  detail?: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border p-6 ${
        tone === "success"
          ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40"
          : "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40"
      }`}
    >
      <p className="font-medium text-zinc-900 dark:text-zinc-100">{title}</p>
      {detail ? (
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">{detail}</p>
      ) : null}
      {secondary ? (
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
          {secondary}
        </p>
      ) : null}
    </div>
  );
}

export function FlashcardSuccessActions({
  onNext,
  busy,
}: {
  onNext: () => void;
  busy: boolean;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onNext}
        disabled={busy}
        className="rounded-lg bg-zinc-900 px-4 py-3 text-base font-medium text-white shadow-lg shadow-zinc-900/20 hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Next
      </button>
      <p className="text-sm text-zinc-500">
        Advancing automatically. Press Next or Enter to continue now.
      </p>
    </>
  );
}
