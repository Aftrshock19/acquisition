# Reusable prompt for performance work with Claude

Paste the block below into Claude whenever you open a performance task
against this repo. It encodes the guardrails in
[performance-guardrails.md](performance-guardrails.md) and forces a
diagnose-before-patch workflow.

Customize only the two bracketed fields at the top.

---

```
You are working in a Next.js App Router + Supabase codebase that has a
permanent performance guardrail system. Read these first and do not
bypass them:
  - docs/performance-guardrails.md
  - docs/hot-path-checklist.md
  - scripts/check-performance-guardrails.mjs

Task: [one-sentence description of the user-visible slowness]
Flows in scope: [e.g. "flashcard submit", "Today page load"]

Rules (non-negotiable):
1. Inspect before patching. Produce a ranked diagnosis with concrete
   evidence (file:line references) BEFORE proposing any code change.
2. Output a numbered list of candidate improvements ranked by
   (impact × safety). Call out which are unsafe and why.
3. Propose exactly ONE minimal safe patch first. Do not bundle multiple
   independent wins into one phase.
4. For that proposed patch, explicitly answer:
   - What is the dominant phase it is expected to move?
   - What pages read the mutated data? Will they go stale?
   - Does it weaken auth, RLS, or JWT validation? If so, stop.
   - Does it add work on a production hot path? If so, gate it.
5. Do not change scheduling logic, record_review, or SQL without
   reading the SQL body from supabase/migrations/ first.
6. After the patch, stop. Ask the user to re-measure with the [perf]
   logs. Do not proceed to the next patch until measurement confirms
   or disconfirms the expected win.
7. Preserve types. Run `npx tsc --noEmit` and `npm run perf:check`
   before declaring done.
8. Never remove or relax `getSupabaseServerContextFast` safety notes,
   NODE_ENV gates on debug paths, or short-TTL aggregate caches.
9. If you add `router.refresh()` after `router.push()`, or broad
   `revalidatePath` fan-out, you must justify it in a code comment
   and call it out in the response.

Required output, in this order:
  A. Diagnosis — ranked list with evidence.
  B. Candidate improvements — ranked, with safety annotation.
  C. Proposed patch — single minimal change.
  D. Risk answers to rule 4.
  E. Files touched and lines.
  F. Expected measurement delta and how to verify.
  G. Next steps — what to measure before the next phase.

Do NOT:
  - refactor unrelated code
  - add speculative abstractions
  - bundle multiple wins into one patch
  - proceed past phase 1 without measurement
  - add noisy comments outside hot-path sensitive spots
```

---

## Why this exists

Past performance work in this repo went wrong when:
- we patched before reading the SQL body of the RPC we were "fixing";
- we narrowed `revalidatePath` without checking what read the data,
  causing stale UI;
- we bundled an auth swap, a parallelization, and a cache into one PR
  and couldn't attribute the remaining slowness;
- we added `router.refresh()` to "make it feel snappier" and doubled
  every navigation's RSC render.

The prompt above forces the model to show its work at each step. It is
slower per turn but faster overall, because nothing gets merged twice.
