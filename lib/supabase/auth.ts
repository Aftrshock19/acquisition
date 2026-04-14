import type { Session, User } from "@supabase/supabase-js";

type SupabaseAuthClient = {
  auth: {
    getUser(): Promise<{
      data: { user: User | null };
    }>;
  };
};

type SupabaseSessionClient = {
  auth: {
    getSession(): Promise<{
      data: { session: Session | null };
      error: { message: string } | null;
    }>;
  };
};

export const SUPABASE_AUTH_UNAVAILABLE_MESSAGE =
  "Couldn't reach Supabase auth. Check NEXT_PUBLIC_SUPABASE_URL, your network connection, or whether the Supabase project is available.";

export async function getSupabaseUser(
  supabase: SupabaseAuthClient,
): Promise<{ user: User | null; error: string | null }> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    return { user, error: null };
  } catch (error) {
    return {
      user: null,
      error: formatSupabaseAuthError(error),
    };
  }
}

/**
 * Fast local-only user retrieval. Reads the session from the cookie/storage
 * without a round-trip to the GoTrue endpoint. Safe on hot paths because:
 *   1. Every downstream DB query carries the JWT and is validated by
 *      PostgREST (signature + expiry) before RLS executes — a forged or
 *      expired token causes the DB query to fail, not a silent auth bypass.
 *   2. RLS policies scope every row by auth.uid(); we cannot leak data to
 *      another user even if this helper returns a stale identity.
 * Prefer `getSupabaseUser` when the caller needs to confirm the user still
 * exists server-side (login, settings, admin flows).
 */
export async function getSupabaseUserFromSession(
  supabase: SupabaseSessionClient,
): Promise<{ user: User | null; error: string | null }> {
  try {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      return { user: null, error: error.message };
    }

    return { user: session?.user ?? null, error: null };
  } catch (error) {
    return {
      user: null,
      error: formatSupabaseAuthError(error),
    };
  }
}

export function formatSupabaseAuthError(error: unknown) {
  if (error instanceof TypeError && error.message === "fetch failed") {
    return SUPABASE_AUTH_UNAVAILABLE_MESSAGE;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return SUPABASE_AUTH_UNAVAILABLE_MESSAGE;
}
