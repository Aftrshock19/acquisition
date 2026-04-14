# Performance guardrails

This file documents the permanent performance rules for this repo. Read
it before editing any of the hot paths listed below. The companion
files are [hot-path-checklist.md](hot-path-checklist.md),
[claude-performance-prompt.md](claude-performance-prompt.md), and the
automated checker at [scripts/check-performance-guardrails.mjs](../scripts/check-performance-guardrails.mjs)
(`npm run perf:check`).

## Mandatory workflow

Do these in order. Skipping steps is how we got the original slowness.

1. **Diagnose first, no fixes.** Read the code. Identify the exact
   request chain. Write it down.
2. **Measure.** Read the `[perf]` logs for the flow. Add one tiny log
   only if a phase is opaque.
3. **Rank** candidate improvements by (impact × safety), worst-first.
4. **Patch the top safe win only.** One change per iteration.
5. **Verify** with `npm run perf:check`, `npx tsc --noEmit`, and the
   hot-path checklist.
6. **Re-measure.** Post before/after numbers. If the change didn't move
   the dominant phase, revert.

## Hot paths in this app

These files are on a user's critical path. Every edit to them should
clear the hot-path checklist.

- [app/actions/srs.ts](../app/actions/srs.ts) — flashcard submit,
  Today loader, reading/listening completion actions.
- [app/reader/actions.ts](../app/reader/actions.ts) — word tap,
  save word.
- [app/today/page.tsx](../app/today/page.tsx) — Today RSC.
- [app/reader/[textId]/page.tsx](../app/reader/[textId]/page.tsx),
  [app/listening/[assetId]/page.tsx](../app/listening/[assetId]/page.tsx)
  — reader/listening shells.
- [components/srs/TodaySession.tsx](../components/srs/TodaySession.tsx),
  [components/reader/ReaderSession.tsx](../components/reader/ReaderSession.tsx),
  [components/listening/ListeningPlayer.tsx](../components/listening/ListeningPlayer.tsx),
  [components/reader/ReaderNextStepCard.tsx](../components/reader/ReaderNextStepCard.tsx)
  — user-facing navigation/completion.
- [lib/supabase/server.ts](../lib/supabase/server.ts),
  [lib/supabase/auth.ts](../lib/supabase/auth.ts) — auth fast path.

## Known failure modes in this repo (do not repeat)

- `router.refresh()` added after `router.push()` — causes a double RSC
  render on every navigation.
- `revalidatePath` fan-out that revalidates `/today`, `/reading`,
  `/listening`, `/reader/*`, `/listening/*` from a single action —
  blows the cache for every subsequent render.
- Narrowing revalidation without checking which pages read the mutated
  data — produces stale UI on `/reading` or `/listening` lists.
- Serial independent lookups on word tap (lemma → form → original_lemma
  → definition) when they can go in one `Promise.all`.
- `auth.getUser()` on every hot action, each adding a GoTrue RTT.
- Debug snapshot code running on every production submit.
- Exact `count=exact` scans on Today load without a short TTL cache.
- Patching before reading the SQL body of the RPC in question.

## Hard rules

### Navigation
- **No `router.refresh()` after `router.push()` on hot paths** without
  a one-line comment explaining why it is necessary. The push already
  triggers an RSC load; a refresh doubles it.
- **No `router.refresh()` after local state update** on hot paths
  without justification. Prefer optimistic local state.

### Revalidation
- **No broad `revalidatePath` fan-out.** Every `revalidatePath` call
  must be justified against the pages that read the mutated data. Keep
  a comment if non-obvious.
- **Do not narrow revalidation** without grepping for the pages/routes
  that read the mutated column/table. Stale-UI regressions are worse
  than slowness.

### Data fetching
- **No serial independent DB lookups.** If two queries don't depend on
  each other's result, they must be in one `Promise.all`.
- **No duplicate fetching within one request.** Use React `cache()`
  (already wired on `getSupabaseServerContext*`). If a helper runs
  twice in one render, wrap it.
- **Short TTL per-user cache for slow-moving diagnostic aggregates**
  (p50 latency, overdue count, etc.), not live fetches on every load.

### Auth
- **Use `getSupabaseServerContextFast` on hot action paths**
  (flashcard submit, word lookup/save, reader/listening completion).
  Use `getSupabaseServerContext` only on login, settings, and admin
  flows where server-side user confirmation is required.
- **Never bypass RLS or JWT validation** for speed. The fast helper is
  safe because every downstream query still carries the JWT and is
  validated by PostgREST; don't replace it with something that isn't.

### Debug / diagnostics
- **No debug-only work on production hot paths.** Gate dev snapshots,
  extra queries, and verbose logs behind `process.env.NODE_ENV !==
  "production"` (or equivalent).
- **`[perf]` logs are allowed** and encouraged on hot paths. They are
  one line, cheap, and the basis for the next measurement.

### SQL / RPC
- **Read the RPC body before changing it.** Migrations live in
  `supabase/migrations/`. The latest body is the one in the
  last-modified migration that redefines the function.
- **No SQL changes without an index-level understanding** of what the
  planner will do. Prefer app-layer caching over SQL rewrites when the
  cost is a slow-moving aggregate.

### Process
- **No performance patch without a before/after request chain** and a
  measurement plan. The patch must name the dominant phase it is
  expected to move.
- **One change per phase.** Don't combine a parallelization, a cache,
  and an SQL rewrite into one PR — you lose the ability to attribute
  the win.

## Good / bad patterns, specific to this codebase

### Bad → Good: navigation after completion
```ts
// BAD — double RSC render
router.push(result.nextPath);
router.refresh();

// GOOD — single navigation; server action already revalidated
router.push(result.nextPath);
```

### Bad → Good: revalidation fan-out
```ts
// BAD — blows all three caches for every completion
revalidatePath("/today");
revalidatePath("/reading");
revalidatePath("/listening");
revalidatePath(`/reader/${textId}`);
revalidatePath(`/listening/${assetId}`);

// GOOD — only what actually reads the mutated data
revalidatePath("/today");
revalidatePath(`/reader/${textId}`);
```

### Bad → Good: serial lookups
```ts
// BAD — 3 RTTs before the definition fetch
const lemmaRow = await selectByLemma(...);
if (!lemmaRow) formRow = await selectByForm(...);
if (!formRow) originalLemmaRow = await selectByOriginalLemma(...);

// GOOD — one RTT wave, priority-ordered after
const [lemmaRow, formRow, originalLemmaRow] = await Promise.all([
  selectByLemma(...), selectByForm(...), selectByOriginalLemma(...),
]);
```

### Bad → Good: auth on hot path
```ts
// BAD — GoTrue RTT on every submit
const { user } = await getSupabaseServerContext();

// GOOD — local cookie session read; JWT still validated by PostgREST
const { user } = await getSupabaseServerContextFast();
```

### Bad → Good: debug on hot path
```ts
// BAD — 3 extra queries per submit for a value nobody reads in prod
const debugSnapshot = await getFlashcardDebugSnapshot(wordId);

// GOOD — gated; dev tooling still works
const debugSnapshot =
  process.env.NODE_ENV === "production"
    ? EMPTY_SNAPSHOT
    : await getFlashcardDebugSnapshot(wordId);
```

### Bad → Good: slow-moving aggregate
```ts
// BAD — exact count scan on every Today load
const { count } = await supabase.from("user_words").select("...", { count: "exact" })...;

// GOOD — 60s per-user cache, log hit/miss
const cached = overdueCountCache.get(user.id);
if (cached && cached.expiresAt > now) return cached.value;
// ... fetch, populate, log [perf] ...
```

## Running the automated checker

```sh
npm run perf:check
```

Exits non-zero if any guardrail rule trips. See the checker file for
exact rules and how to silence a line with a justification comment.
