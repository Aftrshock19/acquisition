const WORD_RE = /[A-Za-zÀ-ÖØ-öø-ÿ]+(?:'[A-Za-zÀ-ÖØ-öø-ÿ]+)?/g;

export function selectWords(text: string, count = 12): string[] {
  const words = text.match(WORD_RE) ?? [];
  const unique = Array.from(new Set(words.map((w) => w.toLowerCase())));
  return unique.slice(0, Math.max(0, count));
}

