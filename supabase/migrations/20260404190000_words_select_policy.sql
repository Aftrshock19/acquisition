-- Allow anyone (including authenticated users via the app) to read from words.
-- Run this in Supabase SQL Editor if the Today page shows no new words.
alter table public.words enable row level security;

drop policy if exists "Allow read words" on public.words;
create policy "Allow read words"
  on public.words for select
  using (true);
