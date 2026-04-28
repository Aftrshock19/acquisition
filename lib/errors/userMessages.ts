// Map raw server / Supabase / Postgres error strings to safe, user-facing copy.
//
// Why: server actions return error.message verbatim (e.g. raw Postgres
// constraint violations). Rendering those in the UI leaks internal detail and
// confuses users. Centralise sanitisation here; raw text stays in server logs.

export const FLASHCARD_SAVE_FALLBACK =
  "Something went wrong while saving this answer. Refresh and try again.";

export const FLASHCARD_EXTEND_FALLBACK =
  "Couldn't add more flashcards. Refresh and try again.";

export const READING_SAVE_FALLBACK =
  "Couldn't save your reading progress. Refresh and try again.";

export const LISTENING_SAVE_FALLBACK =
  "Couldn't save your listening progress. Refresh and try again.";

export const TODAY_QUEUE_FALLBACK =
  "Couldn't load today's words. Refresh and try again.";

const RAW_LEAK_PATTERNS: ReadonlyArray<RegExp> = [
  /violates check constraint/i,
  /violates foreign key constraint/i,
  /violates not-null constraint/i,
  /violates unique constraint/i,
  /duplicate key value/i,
  /relation\s+"/i,
  /column\s+"/i,
  /^\s*PG[A-Z0-9]+:/, // Postgres error code prefix
  /^\s*JWT/i,
  /Could not find the table/i,
  /Could not find the function/i,
];

/**
 * Returns true if `message` looks like raw infra leakage we must not show.
 */
export function looksLikeRawInfraError(
  message: string | null | undefined,
): boolean {
  if (!message) return false;
  return RAW_LEAK_PATTERNS.some((re) => re.test(message));
}

/**
 * Sanitise an error message at the boundary between server-action result and
 * client state. Logs the raw text server-side via the optional `context` tag
 * (callers in server code should pass a console.error themselves before
 * calling this if they need the raw payload preserved).
 */
export function toSafeUserMessage(
  raw: string | null | undefined,
  fallback: string,
): string {
  if (!raw) return fallback;
  if (looksLikeRawInfraError(raw)) return fallback;
  // Short, ascii-only, no quotes, no SQL-ish punctuation = probably safe copy.
  if (raw.length <= 140 && !/["{}<>]/.test(raw)) return raw;
  return fallback;
}
