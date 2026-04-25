"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  completeOnboardingAsBeginner,
  completeOnboardingAsSelfCertified,
} from "@/app/actions/onboarding";
import { CEFR_OPTIONS, type CefrLevel } from "@/lib/onboarding/cefr";

export default function ChooseLevelPage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function pick(level: CefrLevel) {
    startTransition(async () => {
      setError(null);
      const res =
        level === "A0"
          ? await completeOnboardingAsBeginner()
          : await completeOnboardingAsSelfCertified(level);
      if (res.ok) {
        router.push("/");
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <main className="app-shell">
      <section className="app-hero">
        <h1 className="app-title">Choose your starting level</h1>
        <p className="app-subtitle">
          Choose the level that best matches what you can do now. We&apos;ll
          keep adjusting as you learn.
        </p>
      </section>

      <div className="app-card flex flex-col gap-5 p-6 md:p-8">
        {CEFR_OPTIONS.map((opt) => (
          <button
            key={opt.level}
            type="button"
            disabled={isPending}
            onClick={() => pick(opt.level)}
            className="app-link-card flex flex-col gap-2 p-4 text-left disabled:opacity-50"
          >
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {opt.label}
              </span>
              {/* A0 is not a real CEFR level — used as an internal
                  discriminator only, no visible pill. */}
              {opt.level === "A0" ? null : (
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
                  {opt.level}
                </span>
              )}
            </span>
            <span className="text-base text-zinc-800 dark:text-zinc-100">
              {opt.canDo}
            </span>
            <span className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">
              {opt.canDoExpanded}
            </span>
          </button>
        ))}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          type="button"
          disabled={isPending}
          onClick={() => router.back()}
          className="self-start text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
        >
          Go back
        </button>
      </div>
    </main>
  );
}
