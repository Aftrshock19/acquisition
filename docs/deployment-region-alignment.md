# Deployment region alignment

Every server action and RSC render in this app performs at least one
Supabase request. If the Vercel (or other hosting) region does not sit
next to the Supabase region, every user interaction pays an extra
cross-region round-trip — often 80–200 ms per call, multiplied across
the several DB calls each action makes.

This repo does **not** pin a Vercel region (`vercel.json` is absent and
`next.config.ts` has no region config). The default on Vercel is
`iad1` (US-East / Washington DC).

## Action for the maintainer

1. Check the Supabase project region:
   Supabase dashboard → **Project Settings → General → Region**.
2. Pick the matching Vercel region:
   <https://vercel.com/docs/edge-network/regions>.
   Common pairings:
   - Supabase `us-east-1` → Vercel `iad1` (default, no change needed)
   - Supabase `eu-west-1` / `eu-central-1` → Vercel `dub1` / `fra1`
   - Supabase `ap-southeast-1` → Vercel `sin1`
3. If the regions don't match, pin Vercel by adding a `vercel.json`:

   ```json
   { "regions": ["iad1"] }
   ```

   (replace `iad1` with the region closest to the Supabase project)
   or move the Supabase project to match the Vercel region.

Mismatch is a silent, per-user latency floor that no application-level
optimization can eliminate — check this before spending further effort
on code-level performance.
