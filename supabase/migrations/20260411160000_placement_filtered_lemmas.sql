create table if not exists public.placement_filtered_lemmas (
  id uuid primary key default gen_random_uuid(),
  word_id uuid references public.words(id) on delete cascade,
  lemma text not null,
  rank int,
  pos text,
  translation text,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists placement_filtered_lemmas_rank_idx
  on public.placement_filtered_lemmas (rank);
create index if not exists placement_filtered_lemmas_reason_idx
  on public.placement_filtered_lemmas (reason);

alter table public.placement_filtered_lemmas enable row level security;

drop policy if exists "service role manages filtered lemmas"
  on public.placement_filtered_lemmas;
create policy "service role manages filtered lemmas"
  on public.placement_filtered_lemmas
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
