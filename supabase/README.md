# Supabase migrations

Apply these in order so the Today page and SRS work:

1. **First run (tables + RPCs)**  
   In [Supabase Dashboard](https://supabase.com/dashboard) → **SQL Editor**, run the full contents of:
   - `migrations/20260226120000_srs.sql`

2. **Cloze API (updated RPCs)**  
   Then run the full contents of:
   - `migrations/20260226140000_srs_cloze_api.sql`  
   This updates `get_daily_queue` (adds `definition`) and `record_review` (drops `p_correct`), and notifies the API to reload the schema.

3. **If you still see “Could not find the function … in the schema cache”**  
   - In the SQL Editor, run: `NOTIFY pgrst, 'reload schema';`  
   - Or in Dashboard: **Project Settings** → **API** → find the option to reload the schema cache.

4. **Seed words**  
   From the project root: `npm run seed` (uses `data/spanish-frequency.json` and needs `words` table with `lang`, `rank`, `lemma`, `extra`).
