"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAppUrl } from "@/lib/url";
import { headers } from "next/headers";

export async function requestPasswordReset(formData: FormData) {
  const email = formData.get("email");

  const headerStore = await headers();
  console.log(
    `[auth/forgot-password] request email=${typeof email === "string" ? email.slice(0, 3) + "***" : "missing"} ua=${headerStore.get("user-agent") ?? "unknown"} t=${Date.now()}`,
  );

  if (typeof email !== "string" || !email.includes("@")) {
    return { error: "Please enter a valid email address." };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { error: "Authentication is not configured." };
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${getAppUrl()}/auth/reset-password`,
  });

  if (error) {
    // Log the real error for debugging but never expose whether the email exists
    console.error(
      `[auth/forgot-password] resetPasswordForEmail failed: ${error.message}`,
    );
  }

  // Always return the same message to prevent email enumeration
  return {
    success:
      "If an account exists with that email, you'll receive a password reset link shortly. Please check your inbox and spam folder.",
  };
}
