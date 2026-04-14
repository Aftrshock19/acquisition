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
        console.error("[auth/callback] code exchange failed:", error.message);
        const loginUrl = new URL("/login", origin);
        loginUrl.searchParams.set("error", "Confirmation link expired or already used. Please try again.");
        return NextResponse.redirect(loginUrl);
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
