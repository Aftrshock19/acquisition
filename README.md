This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Apply the Supabase migrations in order (e.g. `supabase db push` or run the SQL files in `supabase/migrations/`). Seed vocabulary with `npm run seed` (uses `data/spanish-frequency.json`; replace or expand that file with a full 1–5000 rank Spanish frequency list if desired).

### Database overview

The Supabase database is organized into shared content tables and user-specific progress tables.

- Shared content: `words`, `word_forms`, `texts`, `audio`
- User progress: `user_words`, `review_events`, `daily_sessions`, `user_settings`
- Identity: `auth.users`

`words` is the canonical vocabulary curriculum table. `user_words` is the source of truth for each user's current state for each word. `review_events` is the append-only history of graded reviews. `daily_sessions` tracks guided day-by-day loop progress. `user_settings` stores per-user preferences. `word_forms`, `texts`, and `audio` support inflected form resolution plus matched reading/listening content.

### Seeding words

The `words` table uses columns including `lang`, `rank`, `lemma`, `definition`, optional `surface`, `pos`, `freq`, and `extra` (JSONB). The seed script reads `data/spanish-frequency.json` (array of `{ rank, word, meaning? }`) and upserts with `lang: "es"`, `lemma: word`, `rank`, and definition data. Conflict is on `(lang, rank)`. For CSV or other sources, map to these columns and upsert with the same conflict key.

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
