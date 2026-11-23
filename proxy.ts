import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  classifySupabaseAuthError,
  getSupabaseUser,
} from "@/lib/supabase/auth";

type CookieToSet = { name: string; value: string; options: object };

function getSupabaseAuthCookieNames(request: NextRequest) {
  return request.cookies
    .getAll()
    .filter(
      ({ name }) => name.startsWith("sb-") && name.includes("auth-token"),
    )
    .map(({ name }) => name);
}

// sb-<ref>-auth-token-code-verifier is the PKCE verifier written at sign-up,
// resend and password reset. /auth/callback needs it to exchange the emailed
// code, and it is not a session cookie, so the proxy never deletes it.
function isCodeVerifierCookie(name: string) {
  return name.endsWith("-code-verifier");
}

function isSessionCookie(name: string) {
  return (
    name.startsWith("sb-") &&
    name.includes("auth-token") &&
    !isCodeVerifierCookie(name)
  );
}

// The request's cookies as they will be once the held-back writes are
// applied, so auth-js sees its own earlier writes within this request.
function withCookieWrites(
  cookies: { name: string; value: string }[],
  writes: CookieToSet[],
) {
  const merged = new Map(cookies.map(({ name, value }) => [name, value]));
  writes.forEach(({ name, value }) => merged.set(name, value));
  return [...merged].map(([name, value]) => ({ name, value }));
}

// auth-js runs _removeSession() itself after any non-retryable refresh
// failure, including a GoTrue 500 or a Cloudflare 52x page, so a sign-out
// arrives through setAll before the error can be classified. Drop it unless
// the session was rotated in this request: then the removals are the old
// session's leftover chunks and must be applied with the new value.
function withoutSignOut(writes: CookieToSet[]) {
  const rotated = writes.some(
    ({ name, value }) => isSessionCookie(name) && value !== "",
  );
  if (rotated) return writes;
  return writes.filter(
    ({ name, value }) => !(isSessionCookie(name) && value === ""),
  );
}

function describeAuthError(error: unknown) {
  if (error && typeof error === "object") {
    const { name, status, code, message } = error as Record<string, unknown>;
    return { name, status, code, message };
  }
  return { error: String(error) };
}

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // A visitor mid-signup may hold only the verifier cookie: there is no
  // session to validate or refresh yet.
  const sessionCookieNames =
    getSupabaseAuthCookieNames(request).filter(isSessionCookie);
  if (!url || !key || sessionCookieNames.length === 0) {
    return NextResponse.next({ request });
  }

  // Cookie writes are held back until the auth result is classified, then
  // applied once below.
  let pending: CookieToSet[] = [];
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return withCookieWrites(request.cookies.getAll(), pending);
      },
      setAll(cookiesToSet: CookieToSet[]) {
        // auth-js removes the verifier along with an invalid session; keep
        // it so an email link opened afterwards can still be exchanged.
        pending.push(
          ...cookiesToSet.filter(
            ({ name, value }) => !(isCodeVerifierCookie(name) && value === ""),
          ),
        );
      },
    },
  });

  const { user, cause } = await getSupabaseUser(supabase);
  const kind = user ? "none" : classifySupabaseAuthError(cause);
  const clearSession = kind === "invalid_session" || kind === "session_missing";

  if (clearSession) {
    // A stale refresh token (revoked server-side, rotated keys, etc.) leaves
    // behind auth cookies that can't be used. Supabase may not clear every
    // cookie variant (and does not clear them at all for bad_jwt /
    // user_not_found), so force-delete any that survive to stop the error
    // from repeating on every request.
    console.warn(
      `[proxy] clearing unusable supabase session cookies (${kind})`,
      describeAuthError(cause),
    );
  } else if (!user) {
    // Network failure, 502/503/504 or an unrecognised error: the session may
    // still be valid, so keep the cookies rather than signing the user out.
    const kept = withoutSignOut(pending);
    console.error(
      `[proxy] supabase auth unavailable (${kind}); keeping session cookies${
        kept.length < pending.length ? " (discarded auth-js sign-out)" : ""
      }`,
      describeAuthError(cause),
    );
    pending = kept;
  }

  // Propagate cookie mutations to BOTH request and response. Server
  // components read request.cookies, so without this they'd still see
  // the stale session after Supabase's internal refresh failure
  // cleanup clears cookies, and would re-trigger the same failed
  // refresh. The request must be final before NextResponse.next() copies
  // its headers.
  pending.forEach(({ name, value }) => request.cookies.set(name, value));
  if (clearSession) {
    sessionCookieNames.forEach((name) => request.cookies.delete(name));
  }
  const response = NextResponse.next({ request });
  pending.forEach(({ name, value, options }) =>
    response.cookies.set(name, value, options),
  );
  if (clearSession) {
    sessionCookieNames.forEach((name) => response.cookies.delete(name));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
