import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSupabaseUser } from "@/lib/supabase/auth";

function getSupabaseAuthCookieNames(request: NextRequest) {
  return request.cookies
    .getAll()
    .filter(
      ({ name }) => name.startsWith("sb-") && name.includes("auth-token"),
    )
    .map(({ name }) => name);
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authCookieNames = getSupabaseAuthCookieNames(request);
  if (!url || !key || authCookieNames.length === 0) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: object }[]) {
        // Propagate cookie mutations to BOTH request and response. Server
        // components read request.cookies, so without this they'd still see
        // the stale session after Supabase's internal refresh failure
        // cleanup clears cookies, and would re-trigger the same failed
        // refresh.
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const { user, error } = await getSupabaseUser(supabase);

  // A stale refresh token (revoked server-side, rotated keys, etc.) leaves
  // behind auth cookies that can't be used. Supabase logs the failure
  // internally but may not clear every cookie variant, so force-delete any
  // that survive to stop the error from repeating on every request.
  if (!user && authCookieNames.length > 0) {
    authCookieNames.forEach((name) => {
      if (request.cookies.has(name)) {
        request.cookies.delete(name);
        response.cookies.delete(name);
      }
    });
  }

  if (error && user) {
    console.error("[proxy] supabase auth unavailable", error);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
