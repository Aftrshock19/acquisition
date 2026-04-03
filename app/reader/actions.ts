"use server";

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

const MANUAL_SAVED_DECK_KEY = "manual_saved";

export async function lookupReaderWordAction({
  lang,
  normalized,
}: {
  lang: string;
  normalized: string;
}): Promise<LookupReaderWordResult> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured." };
  }

  const lookup = normalizeWordToken(normalized);
  if (!lookup) {
    return { ok: true, entry: null };
  }

  try {
    const exactEntry = await findWordByLemma(supabase, lang, lookup);
    if (exactEntry) {
      return { ok: true, entry: exactEntry };
    }

    const lemma = await findLemmaByWordForm(supabase, lang, lookup);
    if (!lemma) {
      return { ok: true, entry: null };
    }

    const fallbackEntry = await findWordByLemma(supabase, lang, lemma);
    return { ok: true, entry: fallbackEntry };
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
}: {
  lang: string;
  wordId: string;
}): Promise<SaveReaderWordResult> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured." };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Please sign in to save words." };
  }

  try {
    const deckId = await getManualSavedDeckId(supabase, lang);
    if (!deckId) {
      return { ok: false, error: "Manual saves are not available yet." };
    }

    const { error: userWordError } = await supabase.from("user_words").upsert(
      {
        user_id: user.id,
        word_id: wordId,
        status: "learning",
      },
      {
        onConflict: "user_id,word_id",
        ignoreDuplicates: true,
      },
    );

    if (userWordError) {
      throw new Error(userWordError.message);
    }

    const { error: deckMembershipError } = await supabase
      .from("user_deck_words")
      .upsert(
        {
          user_id: user.id,
          deck_id: deckId,
          word_id: wordId,
          added_via: "reader",
        },
        {
          onConflict: "user_id,deck_id,word_id",
        },
      );

    if (deckMembershipError) {
      throw new Error(deckMembershipError.message);
    }

    return { ok: true, wordId };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Couldn't save this word.",
    };
  }
}

async function findWordByLemma(
  supabase: SupabaseServerClient,
  lang: string,
  lemma: string,
): Promise<ReaderLookupEntry | null> {
  const { data, error } = await supabase
    .from("words")
    .select("id, lemma, definition, pos")
    .eq("lang", lang)
    .eq("lemma", lemma)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  return {
    id: data.id,
    lemma: data.lemma,
    definition: data.definition ?? null,
    pos: data.pos ?? null,
  };
}

async function findLemmaByWordForm(
  supabase: SupabaseServerClient,
  lang: string,
  form: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("word_forms")
    .select("lemma")
    .eq("lang", lang)
    .eq("form", form)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.lemma ?? null;
}

async function getManualSavedDeckId(
  supabase: SupabaseServerClient,
  lang: string,
) {
  const { data, error } = await supabase
    .from("decks")
    .select("id")
    .eq("key", MANUAL_SAVED_DECK_KEY)
    .eq("language", lang)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.id ?? null;
}
