import { createSupabaseServerClient } from "@/lib/supabase/server";
import { markSignupCodeConfirmed } from "@/app/actions/signup-code";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/url";

const GENERIC_ERROR =
  "This confirmation link is no longer valid. Try signing in — if your email is already confirmed it will work. Otherwise, request a new confirmation email below. If you still cannot get in, email du22662@bristol.ac.uk.";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") ?? "email";
  const origin = getAppUrl();

  console.log(
    `[auth/confirm] hit token=${tokenHash ? tokenHash.slice(0, 8) : "none"} type=${type} ua=${request.headers.get("user-agent") ?? "unknown"} ip=${request.headers.get("x-forwarded-for") ?? "unknown"} t=${Date.now()}`,
  );

  const loginRedirect = (params: Record<string, string>) => {
    const u = new URL("/login", origin);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    return NextResponse.redirect(u);
  };

  if (!tokenHash) {
    return loginRedirect({ error: GENERIC_ERROR });
  }

  if (type !== "email") {
    console.warn(`[auth/confirm] rejected non-email type=${type}`);
    return loginRedirect({ error: GENERIC_ERROR });
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return loginRedirect({ error: GENERIC_ERROR });
  }

  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "email",
  });

  if (error) {
    console.warn(`[auth/confirm] verifyOtp failed: ${error.message}`);
    return loginRedirect({ error: GENERIC_ERROR });
  }

  let userId = data?.user?.id ?? null;
  if (!userId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  }

  if (userId) {
    await markSignupCodeConfirmed(userId);
  } else {
    console.warn(
      `[auth/confirm] verifyOtp succeeded but no user id resolved (token=${tokenHash.slice(0, 8)})`,
    );
  }

  // Clear the session that verifyOtp just established in this browser/webview.
  // Email-app webviews are typically a different cookie jar from the user's
  // PWA/Safari, so we don't want to leave them "signed in" here and have the
  // /login page auto-redirect them past the "Email confirmed" banner.
  const { error: signOutError } = await supabase.auth.signOut({
    scope: "local",
  });
  if (signOutError) {
    console.warn(
      `[auth/confirm] signOut after verifyOtp failed: ${signOutError.message}`,
    );
  }

  return loginRedirect({ confirmed: "true" });
}
