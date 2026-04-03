CREATE TABLE IF NOT EXISTS public.decks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  name text NOT NULL,
  language text NOT NULL,
  deck_type text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decks_key_language_unique UNIQUE (key, language)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'decks_key_language_unique'
      AND conrelid = 'public.decks'::regclass
  ) THEN
    ALTER TABLE public.decks
      ADD CONSTRAINT decks_key_language_unique UNIQUE (key, language);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.user_deck_words (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deck_id uuid NOT NULL REFERENCES public.decks(id) ON DELETE CASCADE,
  word_id uuid NOT NULL REFERENCES public.words(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  added_via text NOT NULL DEFAULT 'reader',
  CONSTRAINT user_deck_words_user_deck_word_unique UNIQUE (user_id, deck_id, word_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_deck_words_user_deck_word_unique'
      AND conrelid = 'public.user_deck_words'::regclass
  ) THEN
    ALTER TABLE public.user_deck_words
      ADD CONSTRAINT user_deck_words_user_deck_word_unique UNIQUE (user_id, deck_id, word_id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS decks_language_idx
  ON public.decks (language);

CREATE INDEX IF NOT EXISTS user_deck_words_user_id_idx
  ON public.user_deck_words (user_id);

CREATE INDEX IF NOT EXISTS user_deck_words_deck_id_idx
  ON public.user_deck_words (deck_id);

CREATE INDEX IF NOT EXISTS user_deck_words_word_id_idx
  ON public.user_deck_words (word_id);

ALTER TABLE public.decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_deck_words ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read decks" ON public.decks;
DROP POLICY IF EXISTS "user_deck_words_own_select" ON public.user_deck_words;
DROP POLICY IF EXISTS "user_deck_words_own_insert" ON public.user_deck_words;
DROP POLICY IF EXISTS "user_deck_words_own_delete" ON public.user_deck_words;
DROP POLICY IF EXISTS "user_deck_words_own_update" ON public.user_deck_words;

CREATE POLICY "Allow read decks"
ON public.decks
FOR SELECT
USING (true);

CREATE POLICY "user_deck_words_own_select"
ON public.user_deck_words
FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "user_deck_words_own_insert"
ON public.user_deck_words
FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_deck_words_own_delete"
ON public.user_deck_words
FOR DELETE
USING (user_id = auth.uid());

CREATE POLICY "user_deck_words_own_update"
ON public.user_deck_words
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

INSERT INTO public.decks (key, name, language, deck_type)
VALUES ('manual_saved', 'Manual Saved', 'es', 'system')
ON CONFLICT (key, language) DO UPDATE
SET name = EXCLUDED.name,
    deck_type = EXCLUDED.deck_type;

NOTIFY pgrst, 'reload schema';
