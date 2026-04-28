"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { extendFlashcardsSession } from "@/app/actions/srs";
import { FlashcardAmountChooser } from "@/components/srs/FlashcardAmountChooser";
import {
  FLASHCARD_EXTEND_FALLBACK,
  looksLikeRawInfraError,
} from "@/lib/errors/userMessages";

export function ExtendFlashcardsPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handlePick(count: number) {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await extendFlashcardsSession(count);
      if (!result.ok) {
        setError(readableReason(result.reason));
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        className="self-start text-sm text-zinc-600 underline hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        Do more flashcards
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <FlashcardAmountChooser
        loadingMore={isPending}
        onPick={handlePick}
        onCancel={() => {
          setOpen(false);
          setError(null);
        }}
      />
      {error ? (
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
      ) : null}
    </div>
  );
}

function readableReason(reason: string): string {
  switch (reason) {
    case "invalid_count":
      return "Pick a number between 1 and 200.";
    case "no_session":
    case "wrong_stage":
    case "flashcards_not_complete":
      return "Can't extend right now — refresh and try again.";
    case "not_authenticated":
      return "Sign in and try again.";
    case "listening_already_done":
      return "Your session has moved on. Refresh the page and try again.";
    default:
      if (looksLikeRawInfraError(reason)) {
        console.error("[extendFlashcards] sanitized raw infra error", reason);
      }
      return FLASHCARD_EXTEND_FALLBACK;
  }
}
