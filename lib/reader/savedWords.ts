import { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = NonNullable<
  Awaited<ReturnType<typeof createSupabaseServerClient>>
>;

const MANUAL_SAVED_DECK_KEY = "manual_saved";

export type SavedWordsState = {
  wordIds: string[];
  lemmas: string[];
};

export const EMPTY_SAVED_WORDS_STATE: SavedWordsState = {
  wordIds: [],
  lemmas: [],
};

export async function getSavedWordsState(
  supabase: SupabaseServerClient,
  userId: string,
  language: string,
): Promise<SavedWordsState> {
  try {
    const { data: deck, error: deckError } = await supabase
      .from("decks")
      .select("id")
      .eq("key", MANUAL_SAVED_DECK_KEY)
      .eq("language", language)
      .maybeSingle();

    if (deckError || !deck) {
      return EMPTY_SAVED_WORDS_STATE;
    }

    const { data: memberships, error: membershipError } = await supabase
      .from("user_deck_words")
      .select("word_id")
      .eq("user_id", userId)
      .eq("deck_id", deck.id);

    if (membershipError || !memberships || memberships.length === 0) {
      return EMPTY_SAVED_WORDS_STATE;
    }

    const wordIds = memberships.map((membership) => membership.word_id);
    const { data: savedWords, error: savedWordsError } = await supabase
      .from("words")
      .select("id, lemma")
      .in("id", wordIds);

    if (savedWordsError || !savedWords) {
      return {
        wordIds,
        lemmas: [],
      };
    }

    return {
      wordIds,
      lemmas: savedWords.map((word) => word.lemma),
    };
  } catch {
    return EMPTY_SAVED_WORDS_STATE;
  }
}
