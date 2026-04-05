# Supabase workflow

Use the Supabase CLI from the project root:

1. Initialize the repo once if needed:
   - `/usr/local/bin/supabase init`

2. Link to the hosted project:
   - `/usr/local/bin/supabase link --project-ref xjlowdivepjtukzzehki --password "$SUPABASE_DB_PASSWORD"`

3. Apply migrations:
   - `/usr/local/bin/supabase db push --linked`

4. Seed canonical words from `supabase/seed/spa.csv`:
   - `python3 scripts/generate_words_import_sql.py supabase/seed/spa.csv supabase/.temp/import_words.sql`
   - `/usr/local/bin/supabase db query --linked -f supabase/.temp/import_words.sql`

5. If the API schema cache is stale:
   - `/usr/local/bin/supabase db query --linked "NOTIFY pgrst, 'reload schema';"`

The canonical table is `public.words`. `public.stg_words_spa` is legacy and should not exist after the replacement migration.
