"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useBandAccordion } from "@/lib/ui/useBandAccordion";

// ── Context ─────────────────────────────────────────────────

type BandAccordionCtx = {
  isOpen: (band: string) => boolean;
  toggle: (band: string) => void;
};

const Ctx = createContext<BandAccordionCtx>({
  isOpen: () => false,
  toggle: () => {},
});

// ── Provider ────────────────────────────────────────────────

export function CefrBandAccordion({
  bandLabels,
  defaultOpenBand,
  storageKey,
  children,
}: {
  bandLabels: string[];
  defaultOpenBand: string;
  storageKey: string;
  children: ReactNode;
}) {
  const { isOpen, toggle } = useBandAccordion(
    bandLabels,
    defaultOpenBand,
    storageKey,
  );

  return <Ctx.Provider value={{ isOpen, toggle }}>{children}</Ctx.Provider>;
}

// ── Individual band section ─────────────────────────────────

export function CefrBandAccordionItem({
  bandLabel,
  colorClass,
  statsText,
  children,
}: {
  bandLabel: string;
  colorClass: string;
  statsText: string;
  children: ReactNode;
}) {
  const { isOpen, toggle } = useContext(Ctx);
  const open = isOpen(bandLabel);

  return (
    <section className="app-card-strong flex flex-col p-5 sm:p-6">
      <button
        type="button"
        onClick={() => toggle(bandLabel)}
        className="flex w-full items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <span
            className={`rounded-md border px-3 py-1 text-sm font-semibold ${colorClass}`}
          >
            {bandLabel}
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {statsText}
          </span>
        </div>
        <span
          className={`text-zinc-400 transition-transform dark:text-zinc-500 ${open ? "rotate-90" : ""}`}
        >
          &#9654;
        </span>
      </button>

      {open ? (
        <div className="flex flex-col gap-2 pt-4">{children}</div>
      ) : null}
    </section>
  );
}
