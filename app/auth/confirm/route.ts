import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/url";
import { LOGIN_ERROR_LINK_INVALID } from "@/lib/errors/userMessages";

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
    return loginRedirect({ error: LOGIN_ERROR_LINK_INVALID });
  }

  if (type !== "email") {
    console.warn(`[auth/confirm] rejected non-email type=${type}`);
    return loginRedirect({ error: LOGIN_ERROR_LINK_INVALID });
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return loginRedirect({ error: LOGIN_ERROR_LINK_INVALID });
  }

  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "email",
  });

  if (error) {
    console.warn(`[auth/confirm] verifyOtp failed: ${error.message}`);
    return loginRedirect({ error: LOGIN_ERROR_LINK_INVALID });
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
