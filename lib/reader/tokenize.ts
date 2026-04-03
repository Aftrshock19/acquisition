import type { ReaderToken } from "@/lib/reader/types";

const TOKEN_RE =
  /(\p{L}[\p{L}\p{M}]*(?:['’-]\p{L}[\p{L}\p{M}]*)*|\s+|[^\s\p{L}\p{M}]+)/gu;

const WORD_RE = /^\p{L}[\p{L}\p{M}]*(?:['’-]\p{L}[\p{L}\p{M}]*)*$/u;

export function normalizeWordToken(surface: string) {
  return surface.trim().toLocaleLowerCase("es");
}

export function tokenize(text: string): ReaderToken[] {
  return Array.from(text.matchAll(TOKEN_RE), (match) => {
    const surface = match[0];
    const isWord = WORD_RE.test(surface);

    return {
      surface,
      normalized: isWord ? normalizeWordToken(surface) : surface,
      isWord,
    };
  });
}
