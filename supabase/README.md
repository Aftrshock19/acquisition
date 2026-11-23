# Supabase workflow

Run the Supabase CLI (`supabase` on your PATH, or `npx supabase`) from the project root.

## Local stack (default)

1. Start the local stack (needs Docker). The first start applies `supabase/migrations`:
   - `supabase start`
   - `supabase db reset` rebuilds the local database from the migrations.

2. Seed canonical words from `supabase/seed/new_spa.csv` (gitignored, so copy it in first):
   - `npm run seed -- --dry-run` writes `supabase/.temp/import_words.sql` without applying it.
   - `npm run seed` writes the same file and applies it with `supabase db query --local`.
   - If your CLI has no `db query --local`, apply the file with
     `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/.temp/import_words.sql`.

## Hosted project

`xjlowdivepjtukzzehki` is production (languageacquisition.net) and holds learner data.

1. Link to the hosted project:
   - `supabase link --project-ref xjlowdivepjtukzzehki --password "$SUPABASE_DB_PASSWORD"`

2. Check migrations before pushing:
   - `python3 scripts/check_migrations.py`
   - It lists pending versions, remote-only versions (no local file, so `db push` refuses to run) and duplicate local versions (for example a Finder `... 2.sql` copy, which fails `db push` on the `schema_migrations` primary key). Fix anything other than pending first.
   - Without CLI access, `python3 scripts/check_migrations.py --sql` prints the same check to run in the SQL Editor.

3. Apply migrations:
   - `supabase db push --linked`

4. Seed only when you mean to. Seeding the linked project is an explicit opt-in:
   - `npm run seed:remote` (it passes `--target linked`). The target is never read from the environment, so a plain `npm run seed` goes to the local stack whatever is exported in your shell.
   - It refuses the production ref unless you also pass that ref on the same command: `npm run seed:remote -- --confirm-project-ref <ref>`. This is a flag rather than an environment variable so it cannot carry over to a later run. Take a backup and read the `--dry-run` output first.

5. If the API schema cache is stale:
   - `supabase db query --linked "NOTIFY pgrst, 'reload schema';"`

## What the seed changes

By default the import is safe to rerun on a database with users:

- ranks missing from `public.words` are inserted, with their `public.definitions` rows;
- existing ranks keep their `lemma`, `original_lemma` and `pos`; empty `translation`, `tags`, example sentences and definitions are filled in, and only when the CSV row has the same lemma as the stored word;
- the example sentences are filled as a pair, because the English translates the Spanish. `example_sentence` is filled only when both are empty. `example_sentence_en` is filled only when both are empty or the stored Spanish sentence is the CSV's, so a hand-written sentence never gets the CSV's translation of a different one;
- Spanish `word_forms` with no `word_id` are linked; existing links are kept;
- nothing is deleted.

Two opt-in flags restore the old replace-everything import. Pass them after `--`, for example `npm run seed -- --overwrite`:

- `--overwrite` replaces every column above with the CSV values and relinks every Spanish word form, discarding corrections made in the database.
- `--prune` deletes every word whose rank is not in the CSV. The delete cascades to `user_words`, `review_events`, `exposure_events`, `user_deck_words`, `definitions`, `word_forms` and `placement_filtered_lemmas`, so learners lose their progress on those words. Use it only on an empty or throwaway database.

The canonical lookup table is `public.words`, with large definition text stored in `public.definitions`. `public.stg_words_spa` is legacy and should not exist after the replacement migrations.
