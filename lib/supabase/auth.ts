import {
  isAuthApiError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  type Session,
  type User,
} from "@supabase/supabase-js";

type SupabaseAuthClient = {
  auth: {
    getUser(): Promise<{
      data: { user: User | null };
      // auth-js returns (does not throw) most failures, including network
      // errors and 502/503/504 as AuthRetryableFetchError.
      error?: unknown;
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

/**
 * `error` is only set when getUser() throws, as before: auth-js also returns
 * AuthSessionMissingError for every signed-out visitor, which callers treat
 * as "no user", not as an outage. The raw returned or thrown error is exposed
 * as `cause`; classify it with `classifySupabaseAuthError`.
 */
export async function getSupabaseUser(
  supabase: SupabaseAuthClient,
): Promise<{ user: User | null; error: string | null; cause: unknown }> {
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    return { user, error: null, cause: error ?? null };
  } catch (error) {
    return {
      user: null,
      error: formatSupabaseAuthError(error),
      cause: error,
    };
  }
}

export type SupabaseAuthErrorKind =
  | "none"
  // No usable session in storage (signed out, unreadable cookie, or the
  // server reported session_not_found).
  | "session_missing"
  // The server definitively rejected the stored session.
  | "invalid_session"
  // Network failure or 502/503/504: the session may still be valid.
  | "transient"
  | "unknown";

// GoTrue error codes meaning the stored session can never be used again.
const INVALID_SESSION_ERROR_CODES: ReadonlySet<string> = new Set([
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_not_found",
  "session_expired",
  "bad_jwt",
  "user_not_found",
]);

export function classifySupabaseAuthError(
  error: unknown,
): SupabaseAuthErrorKind {
  if (error == null) return "none";
  if (isAuthRetryableFetchError(error)) return "transient";
  if (error instanceof TypeError && error.message === "fetch failed") {
    return "transient";
  }
  if (isAuthSessionMissingError(error)) return "session_missing";
  if (
    isAuthApiError(error) &&
    typeof error.code === "string" &&
    INVALID_SESSION_ERROR_CODES.has(error.code)
  ) {
    return "invalid_session";
  }
  return "unknown";
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
