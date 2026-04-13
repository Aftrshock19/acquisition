"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Lightweight accordion state for CEFR band sections.
 *
 * - Persists to localStorage under `storageKey`.
 * - On first init, only `defaultOpenBand` is expanded.
 * - Saved manual choices are never overwritten.
 * - Multiple bands can be open at once.
 * - SSR-safe: returns all-collapsed until after mount.
 */
export function useBandAccordion(
  bandLabels: string[],
  defaultOpenBand: string,
  storageKey: string,
) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  // Read from localStorage after mount
  useEffect(() => {
    let saved: Record<string, boolean> = {};
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) saved = JSON.parse(raw);
    } catch {
      // ignore
    }

    // Merge: saved values win, new bands get defaults
    const merged: Record<string, boolean> = {};
    for (const label of bandLabels) {
      if (label in saved) {
        merged[label] = saved[label]!;
      } else {
        merged[label] = label === defaultOpenBand;
      }
    }

    setExpanded(merged);
    setHydrated(true);
    // Only run on mount — bandLabels/defaultOpenBand are derived from server data
    // and won't change during the component lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const toggle = useCallback(
    (band: string) => {
      setExpanded((prev) => {
        const next = { ...prev, [band]: !prev[band] };
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // quota exceeded — still update state
        }
        return next;
      });
    },
    [storageKey],
  );

  const isOpen = useCallback(
    (band: string) => {
      if (!hydrated) return false;
      return expanded[band] ?? false;
    },
    [expanded, hydrated],
  );

  return { isOpen, toggle, hydrated };
}
