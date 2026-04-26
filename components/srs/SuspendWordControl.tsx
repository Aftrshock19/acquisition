"use client";

import { useEffect, useState, useTransition } from "react";
import { suspendWord, unsuspendWord } from "@/app/actions/srs";

type Phase = "idle" | "suspending" | "suspended" | "restoring";

/**
 * Low-friction "Remove from my words" control. Renders a single text link
 * that toggles in place — no modal, no destructive confirm. The action is
 * reversible from the same row via Undo for as long as the panel is open.
 *
 * The control does NOT mutate the surrounding session state; the suspended
 * card stays on screen for the rest of the current review (the user can still
 * press Next). On the next /today render the row is gated out of the review
 * queue by get_daily_queue's status filter (migration 20260426140000).
 */
export function SuspendWordControl({ wordId }: { wordId: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Reset to idle when the card changes.
  useEffect(() => {
    setPhase("idle");
    setError(null);
  }, [wordId]);

  const busy = isPending || phase === "suspending" || phase === "restoring";

  function handleRemove() {
    if (busy) return;
    setError(null);
    setPhase("suspending");
    startTransition(async () => {
      const result = await suspendWord(wordId, "do_not_want");
      if (!result.ok) {
        setPhase("idle");
        setError(readableReason(result.reason));
        return;
      }
      setPhase("suspended");
    });
  }

  function handleUndo() {
    if (busy) return;
    setError(null);
    setPhase("restoring");
    startTransition(async () => {
      const result = await unsuspendWord(wordId);
      if (!result.ok) {
        setPhase("suspended");
        setError(readableReason(result.reason));
        return;
      }
      setPhase("idle");
    });
  }

  if (phase === "suspended" || phase === "restoring") {
    return (
      <div className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
        <span>Removed from your words.</span>
        <button
          type="button"
          onClick={handleUndo}
          disabled={busy}
          className="font-medium text-zinc-900 underline hover:text-zinc-700 disabled:opacity-50 dark:text-zinc-100 dark:hover:text-zinc-300"
        >
          Undo
        </button>
        {error ? (
          <span className="text-red-700 dark:text-red-300">{error}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={handleRemove}
        disabled={busy}
        className="text-sm text-zinc-600 underline hover:text-zinc-800 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        Remove from my words
      </button>
      {error ? (
        <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
      ) : null}
    </div>
  );
}

function readableReason(reason: string): string {
  switch (reason) {
    case "not_authenticated":
      return "Sign in and try again.";
    case "not_found":
      return "Already removed.";
    case "invalid_word_id":
      return "Couldn't identify this word.";
    case "supabase_unavailable":
      return "Connection lost. Try again.";
    default:
      return `Couldn't remove: ${reason}.`;
  }
}
