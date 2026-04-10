This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Apply the Supabase migrations in order with the Supabase CLI. Seed vocabulary from `supabase/seed/new_spa.csv` with `npm run seed` after the project is linked and the migration has been pushed.

### Database overview

The Supabase database is organized into shared content tables and user-specific progress tables.

- Shared content: `words`, `word_forms`, `texts`, `audio`
- User progress: `user_words`, `review_events`, `daily_sessions`, `user_settings`
- Identity: `auth.users`

`words` is the canonical vocabulary curriculum table. `user_words` is the source of truth for each user's current state for each word. `review_events` is the append-only history of graded reviews. `daily_sessions` tracks guided day-by-day loop progress. `user_settings` stores per-user preferences. `word_forms`, `texts`, and `audio` support inflected form resolution plus matched reading/listening content.

Dissertation-facing instrumentation, metric definitions, export formats, and consistency checks are documented in [`docs/dissertation-metrics.md`](docs/dissertation-metrics.md).

Evaluation chapter support (measures, analysis procedure, results scaffold, figure captions, and threats to validity) is in the [`docs/`](docs/) directory:

- [`dissertation-evaluation-measures.md`](docs/dissertation-evaluation-measures.md) — Operationalised measure definitions for the Measures section
- [`dissertation-analysis-procedure.md`](docs/dissertation-analysis-procedure.md) — Export, validation, and analysis workflow for the methodology section
- [`dissertation-results-scaffold.md`](docs/dissertation-results-scaffold.md) — Results section scaffold with placeholders
- [`dissertation-figure-table-captions.md`](docs/dissertation-figure-table-captions.md) — Draft captions for all generated figures and tables
- [`dissertation-threats-to-validity.md`](docs/dissertation-threats-to-validity.md) — Threats-to-validity mapping tied to the implemented measures
- [`evaluation-metric-wording.md`](docs/evaluation-metric-wording.md) — Precise metric wording guide for examiner-safe prose

The reproducible analysis pipeline is in [`analysis/`](analysis/README.md).

### Seeding words

The canonical vocabulary source is `supabase/seed/new_spa.csv`. The import flow is:

```bash
python3 scripts/generate_words_import_sql.py supabase/seed/new_spa.csv supabase/.temp/import_words.sql
/usr/local/bin/supabase db query --linked -f supabase/.temp/import_words.sql
```

The final `public.words` schema is:

- `id uuid primary key default gen_random_uuid()`
- `rank integer not null unique`
- `lemma text not null`
- `original_lemma text not null`
- `translation text`
- `tags text[] not null default '{}'`
- `pos text not null`
- `example_sentence text`
- `example_sentence_en text`
- `created_at timestamptz not null default now()`

The large definition payload lives in `public.definitions`:

- `id uuid primary key references public.words(id) on delete cascade`
- `rank integer not null unique`
- `lemma text not null`
- `translation text`
- `definition_es text`
- `definition_en text`
- `created_at timestamptz not null default now()`

The import uses `public.words_import_raw` as a staging table, accepts both the legacy `spa.csv` header set and the current `new_spa.csv` header set, persists `tags` on `public.words`, writes the large definition text to `public.definitions`, normalizes `pos`, and upserts on `rank` so reruns are idempotent.

### Generating TypeScript types from Supabase

From project root, with Supabase CLI linked to your project:

```bash
npx supabase gen types typescript --project-id YOUR_PROJECT_REF > lib/supabase/database.types.ts
```

Use the generated types in server client and actions (e.g. type the Supabase client with `Database`).

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
