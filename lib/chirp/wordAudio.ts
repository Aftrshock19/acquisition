import {
  LISTENING_AUDIO_BUCKET,
  storagePublicUrl,
  wordAudioStoragePath,
  type WordAudioVariant,
} from "./storage";

// ── Local export helpers ──────────────────────────────────────
//
// Local export layout lives at the repo root:
//   word-audio/{rank}-{lemma}.mp3
//   sentence-audio/{rank}-{lemma}.mp3

export const LOCAL_LEMMA_DIRNAME = "word-audio";
export const LOCAL_SENTENCE_DIRNAME = "sentence-audio";

/** Sanitize a lemma for filesystem use — keeps accents, drops punctuation. */
export function sanitizeLemma(lemma: string): string {
  return lemma
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}-]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

/**
 * Basename for a word's local audio file. Variant picks the folder; both
 * folders share the same basename per word.
 */
export function wordAudioLocalFilename(
  rank: number,
  lemma: string,
  collisionSuffix?: string,
): string {
  const safe = sanitizeLemma(lemma);
  const suffix = collisionSuffix ? `__${collisionSuffix}` : "";
  return `${rank}-${safe}${suffix}.mp3`;
}

/** Folder name (not absolute path) for a variant's local files. */
export function localDirnameForVariant(variant: WordAudioVariant): string {
  return variant === "lemma" ? LOCAL_LEMMA_DIRNAME : LOCAL_SENTENCE_DIRNAME;
}

export type WordAudioRow = {
  id: string;
  lemma: string;
  example_sentence: string | null;
  lemma_audio_path: string | null;
  lemma_sentence_audio_path: string | null;
};

export type WordAudioUrls = {
  lemmaUrl: string | null;
  sentenceUrl: string | null;
};

/**
 * Turn the two path columns from a `words` row into playable public URLs.
 * Returns `null` for any field that has not been generated yet.
 */
export function wordAudioUrls(
  row: Pick<WordAudioRow, "lemma_audio_path" | "lemma_sentence_audio_path">,
  supabaseUrl: string,
): WordAudioUrls {
  return {
    lemmaUrl: row.lemma_audio_path
      ? storagePublicUrl(supabaseUrl, row.lemma_audio_path)
      : null,
    sentenceUrl: row.lemma_sentence_audio_path
      ? storagePublicUrl(supabaseUrl, row.lemma_sentence_audio_path)
      : null,
  };
}

/**
 * Which DB column holds the path for a given variant.
 */
export function wordAudioPathColumn(
  variant: WordAudioVariant,
): "lemma_audio_path" | "lemma_sentence_audio_path" {
  return variant === "lemma" ? "lemma_audio_path" : "lemma_sentence_audio_path";
}

/**
 * Pick the canonical sentence source for word-sentence audio.
 * Returns `null` if no usable sentence is available.
 */
export function canonicalWordSentence(
  row: Pick<WordAudioRow, "example_sentence">,
): string | null {
  const s = row.example_sentence?.trim();
  return s && s.length > 0 ? s : null;
}

export { LISTENING_AUDIO_BUCKET, wordAudioStoragePath };
