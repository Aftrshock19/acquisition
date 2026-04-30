import { createSupabaseServerClient } from "@/lib/supabase/server";
import { markSignupCodeConfirmed } from "@/lib/auth/signupCodes";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  shouldRedirectToIntro,
  shouldRedirectToPlacement,
} from "@/lib/onboarding/state";
import { getAppUrl } from "@/lib/url";

const GENERIC_ERROR =
  "This confirmation link is no longer valid. Try signing in — if your email is already confirmed it will work. Otherwise, request a new confirmation email below. If you still cannot get in, email du22662@bristol.ac.uk.";

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

  if (errorParam) {
    console.warn(`[auth/callback] provider error: ${errorParam}`);
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("error", GENERIC_ERROR);
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

        // The code may have already been consumed by a prefetcher/link scanner,
        // OR the verifier cookie is missing because the link opened in a
        // different browser/webview than the one that started signup.
        // If the user's browser already holds a valid session cookie, let them through.
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          console.log(
            `[auth/callback] existing session found for ${user.id}, proceeding despite code exchange failure`,
          );
          await markSignupCodeConfirmed(user.id);
        } else {
          console.error(
            `[auth/callback] no existing session — redirecting to login`,
          );
          const loginUrl = new URL("/login", origin);
          loginUrl.searchParams.set("error", GENERIC_ERROR);
          return NextResponse.redirect(loginUrl);
        }
      } else {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          await markSignupCodeConfirmed(user.id);
        }
      }
    }
  }

  // First-run gate: if the freshly signed-in user has never seen the
  // introduction flow, route them through it before their requested landing.
  if (await shouldRedirectToIntro()) {
    return NextResponse.redirect(new URL("/onboarding", origin));
  }
  if (await shouldRedirectToPlacement()) {
    return NextResponse.redirect(new URL("/placement", origin));
  }

  // Only allow relative paths for the `next` redirect to prevent open redirect
  const safeDest = next.startsWith("/") ? next : "/";
  return NextResponse.redirect(new URL(safeDest, origin));
}
