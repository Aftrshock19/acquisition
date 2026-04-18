const CEFR_BANDS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
const SUFFIXES = ["--", "-", "", "+", "++"] as const;

export function deriveSubstageLabel(stageIndex: number): string {
  if (stageIndex < 1 || stageIndex > 30) {
    return String(stageIndex);
  }
  const bandIndex = Math.floor((stageIndex - 1) / 5);
  const positionInBand = (stageIndex - 1) % 5;
  const band = CEFR_BANDS[bandIndex];
  const suffix = SUFFIXES[positionInBand];
  return `${band}${suffix}`;
}

export function deriveCefrBand(stageIndex: number): string {
  if (stageIndex < 1 || stageIndex > 30) {
    return "";
  }
  return CEFR_BANDS[Math.floor((stageIndex - 1) / 5)];
}
