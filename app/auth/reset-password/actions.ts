"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

const MIN_PASSWORD_LENGTH = 6;

export async function resetPassword(formData: FormData) {
  const tokenHash = formData.get("token_hash");
  const type = formData.get("type");
  const password = formData.get("password");
  const confirmPassword = formData.get("confirmPassword");

  const headerStore = await headers();
  console.log(
    `[auth/reset-password] submit token=${typeof tokenHash === "string" ? tokenHash.slice(0, 8) : "missing"} ua=${headerStore.get("user-agent") ?? "unknown"} t=${Date.now()}`,
  );

  if (typeof tokenHash !== "string" || !tokenHash) {
    return { error: "Invalid or missing reset token." };
  }

  if (typeof type !== "string" || type !== "recovery") {
    return { error: "Invalid reset link." };
  }

  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return {
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { error: "Authentication is not configured." };
  }

  // Verify the OTP to establish a session — this is intentionally done on POST
  // (form submit), not on GET (page load), so email prefetchers cannot consume
  // the token by simply fetching the link.
  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "recovery",
  });

  if (verifyError) {
    console.error(
      `[auth/reset-password] verifyOtp failed: ${verifyError.message}`,
    );
    const isExpiredOrInvalid =
      verifyError.message.toLowerCase().includes("expired") ||
      verifyError.message.toLowerCase().includes("invalid") ||
      verifyError.message.toLowerCase().includes("already used");
    return {
      error: isExpiredOrInvalid
        ? "This reset link has expired or already been used. Please request a new one."
        : "Something went wrong verifying your reset link. Please try again.",
    };
  }

  // Session is now established — update the password
  const { error: updateError } = await supabase.auth.updateUser({
    password,
  });

  if (updateError) {
    console.error(
      `[auth/reset-password] updateUser failed: ${updateError.message}`,
    );
    return {
      error: "Failed to update password. Please try again.",
    };
  }

  redirect("/");
}
