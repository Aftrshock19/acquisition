import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { shouldRedirectToIntro } from "@/lib/onboarding/state";
import { getAppUrl } from "@/lib/url";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";
  const errorParam = url.searchParams.get("error_description");

  const origin = getAppUrl();

  // Diagnostic: log every hit to identify prefetcher double-hits
  console.log(
    `[auth/callback] hit code=${code ? code.slice(0, 8) : "none"} ua=${request.headers.get("user-agent") ?? "unknown"} ip=${request.headers.get("x-forwarded-for") ?? "unknown"} t=${Date.now()}`,
  );

  // Surface Supabase-level errors (e.g. expired or invalid confirmation link)
  if (errorParam) {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("error", errorParam);
    return NextResponse.redirect(loginUrl);
  }

  if (code) {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        console.warn(
          `[auth/callback] code exchange failed: ${error.message} — checking for existing session`,
        );

        // The code may have already been consumed by a prefetcher/link scanner.
        // If the user's browser already holds a valid session cookie, let them through.
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          console.log(
            `[auth/callback] existing session found for ${user.id}, proceeding despite code exchange failure`,
          );
        } else {
          console.error(
            `[auth/callback] no existing session — redirecting to login`,
          );
          const loginUrl = new URL("/login", origin);
          const isAlreadyUsed =
            error.message.toLowerCase().includes("already used") ||
            error.message.toLowerCase().includes("expired") ||
            error.message.toLowerCase().includes("invalid");
          loginUrl.searchParams.set(
            "error",
            isAlreadyUsed
              ? "Confirmation link expired or already used. Please try again."
              : error.message,
          );
          return NextResponse.redirect(loginUrl);
        }
      }
    }
  }

  // First-run gate: if the freshly signed-in user has never seen the
  // introduction flow, route them through it before their requested landing.
  if (await shouldRedirectToIntro()) {
    return NextResponse.redirect(new URL("/onboarding", origin));
  }

  // Only allow relative paths for the `next` redirect to prevent open redirect
  const safeDest = next.startsWith("/") ? next : "/";
  return NextResponse.redirect(new URL(safeDest, origin));
}
