# Hot-path checklist

Run through this before merging any change that touches the files
listed in [performance-guardrails.md](performance-guardrails.md#hot-paths-in-this-app).

Mentally tick every box. If you can't, add a one-line justification in
the PR or a code comment.

## Navigation
- [ ] No new `router.refresh()` after `router.push()`.
- [ ] No new `router.refresh()` after local state update that the UI
      already reflects.
- [ ] If either is necessary, a code comment explains why.

## Revalidation
- [ ] Every new `revalidatePath` / `revalidateTag` is paired with a
      reason (which page reads the mutated data?).
- [ ] If you narrowed revalidation, you grepped for the pages/routes
      that read the mutated column and confirmed they still update.

## Data fetching
- [ ] No new serial independent awaits that could be one `Promise.all`.
- [ ] No function fetches the same row twice in one request; helpers
      that are called from multiple places are wrapped in React
      `cache()` or explicitly deduped.
- [ ] Slow-moving aggregates (overdue count, p50 latency, etc.) read
      from the short-TTL cache, not the DB, on every request.

## Auth
- [ ] Hot action uses `getSupabaseServerContextFast`, not
      `getSupabaseServerContext`.
- [ ] No security check was removed or relaxed to speed up the path.

## Debug / diagnostics
- [ ] No debug-only DB queries, snapshots, or verbose logs execute in
      production on this path.
- [ ] Any new diagnostic is gated by `process.env.NODE_ENV !== "production"`
      or an explicit opt-in flag.

## SQL / RPC
- [ ] If the change touches an RPC, you read the SQL body in
      `supabase/migrations/` first.
- [ ] No index-dependent assumption is made without checking the
      migration that defines the index.

## Measurement
- [ ] The `[perf]` log for this flow is still correct and covers the
      dominant phase.
- [ ] You have a before/after number for the flow (or an explicit
      reason you don't, e.g. only refactoring types).

## Flows that must clear this checklist
- Today page load
- Flashcard submit / check
- Reader word tap
- Save word in reader
- Listening transcript tap
- Reading completion action
- Listening completion action
- Navigation back to Today after reading/listening completion
