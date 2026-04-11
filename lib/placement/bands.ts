export type FrequencyBand = {
  index: number;
  start: number;
  end: number;
  label: string;
};

export const FREQUENCY_BANDS: readonly FrequencyBand[] = [
  { index: 0, start: 1, end: 500, label: "1–500" },
  { index: 1, start: 501, end: 1000, label: "501–1000" },
  { index: 2, start: 1001, end: 1500, label: "1001–1500" },
  { index: 3, start: 1501, end: 2000, label: "1501–2000" },
  { index: 4, start: 2001, end: 3000, label: "2001–3000" },
  { index: 5, start: 3001, end: 4000, label: "3001–4000" },
  { index: 6, start: 4001, end: 5000, label: "4001–5000" },
] as const;

export function bandForRank(rank: number): FrequencyBand {
  for (const b of FREQUENCY_BANDS) {
    if (rank >= b.start && rank <= b.end) return b;
  }
  return rank < 1 ? FREQUENCY_BANDS[0] : FREQUENCY_BANDS[FREQUENCY_BANDS.length - 1];
}

export function bandByIndex(index: number): FrequencyBand | null {
  if (index < 0 || index >= FREQUENCY_BANDS.length) return null;
  return FREQUENCY_BANDS[index];
}

// The full Spanish frequency table goes to ~34619. Recalibration and the
// new-word picker clamp to this number rather than the legacy band ceiling
// of 5000. The legacy FREQUENCY_BANDS export is kept for analytics that
// still group at the 1–5000 resolution.
export const MAX_TRACKED_RANK = 34000;
