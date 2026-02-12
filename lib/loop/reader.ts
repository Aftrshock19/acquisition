export function toReadingBlocks(text: string): string[] {
  return text
    .split(/\n{2,}/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

