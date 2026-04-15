/**
 * Helpers for building Supabase Storage paths for listening audio assets.
 *
 * Path convention:
 *   audio/<languageCode>/<textId>/<variant>.mp3
 *
 * This scheme is deterministic: given a text ID and variant, the storage
 * path is always the same, making assets easy to discover, cache, and
 * eventually serve for offline use.
 */

export const LISTENING_AUDIO_BUCKET = "listening-audio";

/**
 * Build a deterministic storage path from a text ID and variant.
 *
 * Example: audioStoragePath("abc-123", "support", "es-ES")
 *   => "audio/es-ES/abc-123/support.mp3"
 */
export function audioStoragePath(
  textId: string,
  variant: string,
  languageCode = "es-ES",
): string {
  return `audio/${languageCode}/${textId}/${variant}.mp3`;
}

/**
 * Build the public URL for an asset stored in the listening-audio bucket.
 */
export function storagePublicUrl(
  supabaseUrl: string,
  storagePath: string,
): string {
  return `${supabaseUrl}/storage/v1/object/public/${LISTENING_AUDIO_BUCKET}/${storagePath}`;
}

/**
 * Build a deterministic storage path from a passage filename (legacy helper).
 *
 * Example: passageFilenameToStoragePath("a1_short_stage1_passage1.txt", "support")
 *   => "support/a1_short_stage1_passage1.mp3"
 */
/**
 * Word-audio variants supported for the per-word audio proof.
 *   "lemma"          → pronunciation of the lemma alone
 *   "lemma-sentence" → pronunciation of the canonical example sentence
 */
export type WordAudioVariant = "lemma" | "lemma-sentence";

/**
 * Deterministic storage path for per-word audio.
 *
 * Example:
 *   wordAudioStoragePath("abc-123", "lemma")
 *     => "audio/es-ES/words/abc-123/lemma.mp3"
 *   wordAudioStoragePath("abc-123", "lemma-sentence")
 *     => "audio/es-ES/words/abc-123/lemma-sentence.mp3"
 */
export function wordAudioStoragePath(
  wordId: string,
  variant: WordAudioVariant,
  languageCode = "es-ES",
): string {
  return `audio/${languageCode}/words/${wordId}/${variant}.mp3`;
}

export function passageFilenameToStoragePath(
  passageFilename: string,
  variant: string,
): string {
  const base = passageFilename.replace(/\.txt$/, "");
  return `${variant}/${base}.mp3`;
}
