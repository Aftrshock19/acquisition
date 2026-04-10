"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { completeReadingStep } from "@/app/actions/srs";

type ReaderNextStepCardProps = {
  textId: string;
  listeningAssetId: string | null;
  readingDone: boolean;
  listeningDone: boolean;
  getReadingTimeSeconds?: () => number;
};

export function ReaderNextStepCard({
  textId,
  listeningAssetId,
  readingDone,
  listeningDone,
  getReadingTimeSeconds,
}: ReaderNextStepCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const hasPendingListening = readingDone && !listeningDone && listeningAssetId;
  const finishedForToday = readingDone && (listeningDone || listeningAssetId === null);

  return (
    <section className="app-card-muted flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
          Daily loop
        </p>
        <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          {finishedForToday
            ? "Reading logged"
            : hasPendingListening
              ? "Listening is ready"
              : "Finish this reading block"}
        </h2>
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          {finishedForToday
            ? "This reading step is already saved for today."
            : hasPendingListening
              ? "You can move straight into the matched audio now."
              : "When you are done, save this reading step and move on without extra admin."}
        </p>
      </div>

      {submitError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          {submitError}
        </p>
      ) : null}

      {hasPendingListening ? (
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href={`/listening/${listeningAssetId}`}
            className="app-button"
          >
            Continue to listening
          </Link>
          <Link href="/today" className="app-button-secondary">
            Back to today
          </Link>
        </div>
      ) : finishedForToday ? (
        <Link href="/today" className="app-button">
          Back to today
        </Link>
      ) : (
        <button
          type="button"
          disabled={pending}
          className="app-button self-start"
          onClick={() => {
            startTransition(async () => {
              setSubmitError(null);
              const result = await completeReadingStep({
                textId,
                readingTimeSeconds: getReadingTimeSeconds?.() ?? 0,
              });

              if (!result.ok) {
                setSubmitError(result.error);
                return;
              }

              router.push(result.nextPath);
              router.refresh();
            });
          }}
        >
          {pending
            ? "Saving..."
            : listeningAssetId
              ? "Complete reading and continue"
              : "Complete reading"}
        </button>
      )}
    </section>
  );
}
