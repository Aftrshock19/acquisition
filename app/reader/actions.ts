"use server";

import { getTodayDailySessionRow, getTodaySessionDate } from "@/lib/loop/dailySessions";
import { getSupabaseUserFromSession } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeWordToken } from "@/lib/reader/tokenize";
import type {
  LookupReaderWordResult,
  ReaderLookupEntry,
  SaveReaderWordResult,
} from "@/lib/reader/types";

type SupabaseServerClient = NonNullable<
  Awaited<ReturnType<typeof createSupabaseServerClient>>
>;

type WordLookupRow = {
  id: string;
  lemma: string;
  translation?: string | null;
  pos?: string | null;
};

type DefinitionLookupRow = {
  translation?: string | null;
  definition_en?: string | null;
  definition_es?: string | null;
};

const MANUAL_SAVED_DECK_KEY = "manual_saved";

// Stable per-language id; cached across requests in-process. Safe because
// deck rows are seeded once per (key, language) and never reassigned.
const manualSavedDeckIdCache = new Map<string, string>();

export async function lookupReaderWordAction({
  lang,
  normalized,
}: {
  lang: string;
  normalized: string;
}): Promise<LookupReaderWordResult> {
  const __perfStart = performance.now();
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured." };
  }

  const lookup = normalizeWordToken(normalized);
  if (!lookup) {
    return { ok: true, entry: null };
  }

  try {
    // Fire all three candidate lookups in parallel. Priority order (preserved
    // from the serial version) is: exact lemma > word_forms match > original_lemma.
    const [lemmaRow, formRow, originalLemmaRow] = await Promise.all([
      selectWordByLemma(supabase, lookup),
      selectWordFormRow(supabase, lang, lookup),
      selectWordByOriginalLemma(supabase, lookup),
    ]);
    const __perfCandidatesDone = performance.now();

    let wordRow: WordLookupRow | null = lemmaRow;

    if (!wordRow && formRow) {
      if (formRow.word_id) {
        wordRow = await selectWordById(supabase, formRow.word_id);
      }
      if (!wordRow && formRow.lemma) {
        wordRow = await selectWordByLemma(supabase, formRow.lemma);
      }
    }

    if (!wordRow) {
      wordRow = originalLemmaRow;
    }

    if (!wordRow) {
      console.log(
        `[perf] lookupReaderWordAction total=${Math.round(performance.now() - __perfStart)}ms ` +
          `candidates=${Math.round(__perfCandidatesDone - __perfStart)}ms miss`,
      );
      return { ok: true, entry: null };
    }

    const entry = await toReaderLookupEntry(supabase, wordRow);
    console.log(
      `[perf] lookupReaderWordAction total=${Math.round(performance.now() - __perfStart)}ms ` +
        `candidates=${Math.round(__perfCandidatesDone - __perfStart)}ms ` +
        `definition=${Math.round(performance.now() - __perfCandidatesDone)}ms`,
    );
    return { ok: true, entry };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Couldn't look up this word.",
    };
  }
}

export async function saveReaderWordAction({
  lang,
  wordId,
  textId,
  saveSource = "reader",
}: {
  lang: string;
  wordId: string;
  textId?: string | null;
  saveSource?: "reader" | "flashcard";
}): Promise<SaveReaderWordResult> {
  const __perfStart = performance.now();
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured." };
  }

  const { user, error } = await getSupabaseUserFromSession(supabase);
  if (error) {
    return { ok: false, error };
  }

  if (!user) {
    return { ok: false, error: "Please sign in to save words." };
  }
  const __perfAuthDone = performance.now();

  try {
    // daily session lookup and deck id lookup are independent; run together.
    const [currentDailySession, deckId] = await Promise.all([
      getTodayDailySessionRow(supabase, user.id),
      getManualSavedDeckId(supabase, lang),
    ]);
    if (!deckId) {
      return { ok: false, error: "Manual saves are not available yet." };
    }
    const __perfLookupsDone = performance.now();

    // Both upserts target different tables and are idempotent; run in parallel.
    const [userWordResult, deckMembershipResult] = await Promise.all([
      supabase.from("user_words").upsert(
        {
          user_id: user.id,
          word_id: wordId,
          status: "learning",
        },
        {
          onConflict: "user_id,word_id",
          ignoreDuplicates: true,
        },
      ),
      supabase.from("user_deck_words").upsert(
        {
          user_id: user.id,
          deck_id: deckId,
          word_id: wordId,
          added_via: saveSource,
          session_date: getTodaySessionDate(),
          daily_session_id: currentDailySession?.id ?? null,
          text_id: textId ?? currentDailySession?.reading_text_id ?? null,
        },
        {
          onConflict: "user_id,deck_id,word_id",
          ignoreDuplicates: true,
        },
      ),
    ]);

    if (userWordResult.error) {
      throw new Error(userWordResult.error.message);
    }
    if (deckMembershipResult.error) {
      throw new Error(deckMembershipResult.error.message);
    }

    console.log(
      `[perf] saveReaderWordAction total=${Math.round(performance.now() - __perfStart)}ms ` +
        `auth=${Math.round(__perfAuthDone - __perfStart)}ms ` +
        `lookups=${Math.round(__perfLookupsDone - __perfAuthDone)}ms ` +
        `writes=${Math.round(performance.now() - __perfLookupsDone)}ms`,
    );
    return { ok: true, wordId, highlightForms: [] };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Couldn't save this word.",
    };
  }
}

async function selectWordByLemma(
  supabase: SupabaseServerClient,
  lemma: string,
): Promise<WordLookupRow | null> {
  const { data, error } = await supabase
    .from("words")
    .select("id, lemma, translation, pos")
    .eq("lemma", lemma)
    .order("rank", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as WordLookupRow | null) ?? null;
}

async function selectWordByOriginalLemma(
  supabase: SupabaseServerClient,
  originalLemma: string,
): Promise<WordLookupRow | null> {
  const { data, error } = await supabase
    .from("words")
    .select("id, lemma, translation, pos")
    .eq("original_lemma", originalLemma)
    .order("rank", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as WordLookupRow | null) ?? null;
}

async function selectWordFormRow(
  supabase: SupabaseServerClient,
  lang: string,
  form: string,
): Promise<{ word_id: string | null; lemma: string } | null> {
  const { data, error } = await supabase
    .from("word_forms")
    .select("word_id, lemma")
    .eq("lang", lang)
    .eq("form", form)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as { word_id: string | null; lemma: string } | null) ?? null;
}

async function selectWordById(
  supabase: SupabaseServerClient,
  id: string,
): Promise<WordLookupRow | null> {
  const { data, error } = await supabase
    .from("words")
    .select("id, lemma, translation, pos")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as WordLookupRow | null) ?? null;
}

async function getManualSavedDeckId(
  supabase: SupabaseServerClient,
  lang: string,
) {
  const cached = manualSavedDeckIdCache.get(lang);
  if (cached) {
    return cached;
  }

  const { data, error } = await supabase
    .from("decks")
    .select("id")
    .eq("key", MANUAL_SAVED_DECK_KEY)
    .eq("language", lang)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const id = data?.id ?? null;
  if (id) {
    manualSavedDeckIdCache.set(lang, id);
  }
  return id;
}

async function getDefinitionLookupRow(
  supabase: SupabaseServerClient,
  wordId: string,
): Promise<DefinitionLookupRow | null> {
  const { data, error } = await supabase
    .from("definitions")
    .select("translation, definition_en, definition_es")
    .eq("id", wordId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function toReaderLookupEntry(
  supabase: SupabaseServerClient,
  data: WordLookupRow | null | undefined,
): Promise<ReaderLookupEntry | null> {
  if (!data) {
    return null;
  }

  const definitions = await getDefinitionLookupRow(supabase, data.id);

  return {
    id: data.id,
    lemma: data.lemma,
    definition:
      data.translation ??
      definitions?.translation ??
      definitions?.definition_en ??
      definitions?.definition_es ??
      null,
    pos: data.pos ?? null,
  };
}
