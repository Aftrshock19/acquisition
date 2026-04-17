import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { cache } from "react";
import { cookies } from "next/headers";
import {
  getSupabaseUser,
  getSupabaseUserFromSession,
} from "@/lib/supabase/auth";

export const createSupabaseServerClient = cache(async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: object }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch (err) {
          // Next.js disallows cookie writes from Server Components — this fires
          // on every SC render where Supabase tries to refresh a session and is
          // safe to ignore. Only warn on unexpected errors (e.g. a Route Handler
          // or Server Action failing to set cookies for a real reason).
          const msg = err instanceof Error ? err.message : String(err);
          const isExpectedServerComponentError =
            msg.includes("Cookies can only be modified") ||
            msg.includes("Server Action") ||
            msg.includes("Route Handler");
          if (!isExpectedServerComponentError) {
            console.warn("[supabase/server] cookie set failed:", err);
          }
        }
      },
    },
  });
});

export const getSupabaseServerContext = cache(async function getSupabaseServerContext(): Promise<{
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  user: User | null;
  error: string | null;
}> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { supabase: null, user: null, error: null };
  }

  const __perfStart = performance.now();
  const { user, error } = await getSupabaseUser(supabase);
  console.log(
    `[perf] auth.getUser total=${Math.round(performance.now() - __perfStart)}ms`,
  );
  return { supabase, user, error };
});

/**
 * Fast variant of getSupabaseServerContext for hot interaction paths
 * (flashcard submit, word lookup/save, reading/listening completion).
 * Uses a local cookie-based session read instead of a GoTrue round-trip.
 * See `getSupabaseUserFromSession` for the security rationale.
 */
export const getSupabaseServerContextFast = cache(async function getSupabaseServerContextFast(): Promise<{
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  user: User | null;
  error: string | null;
}> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { supabase: null, user: null, error: null };
  }

  const __perfStart = performance.now();
  const { user, error } = await getSupabaseUserFromSession(supabase);
  console.log(
    `[perf] auth.getSession total=${Math.round(performance.now() - __perfStart)}ms`,
  );
  return { supabase, user, error };
});
