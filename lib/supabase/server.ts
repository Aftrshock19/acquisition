import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { cache } from "react";
import { cookies } from "next/headers";
import { getSupabaseUser } from "@/lib/supabase/auth";

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
        } catch {
          // setAll from Server Component; middleware refreshes sessions
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

  const { user, error } = await getSupabaseUser(supabase);
  return { supabase, user, error };
});
