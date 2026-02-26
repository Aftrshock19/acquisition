# AGENTS.md

## Cursor Cloud specific instructions

This is **Acquisition**, an early-stage language learning web app built with **Next.js 16 (App Router)**, React 19, Tailwind CSS v4, and TypeScript 5.

### Service overview

| Service | Command | Port | Notes |
|---------|---------|------|-------|
| Next.js dev server | `npm run dev` | 3000 | The only service; runs the entire app |

### Key commands

See `package.json` `scripts` for the canonical list:

- **Dev server:** `npm run dev`
- **Lint:** `npm run lint` (ESLint 9, flat config in `eslint.config.mjs`)
- **Build:** `npm run build`
- **Start (production):** `npm run start`

### Non-obvious notes

- No `.env` file is required to run the app in its current state; all data is hardcoded/stubbed.
- Supabase types are stubbed under `lib/supabase/` but the SDK is **not installed** as a dependency. Auth and DB are no-ops.
- The `middleware.ts` is a no-op pass-through; Next.js 16 warns about it being deprecated in favor of "proxy".
- Dynamic routes: `/reader/[textId]` loads texts from `lib/loop/texts.ts` (in-memory stub array). The only seeded textId is `welcome`.
- No automated test suite exists yet (no test framework configured).
