import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

export type SignupCodeValidateResult =
  | { state: "unused" }
  | { state: "pending_same_email" }
  | { state: "already_confirmed_same_email" }
  | { state: "invalid_or_used" };

export type SignupCodeClaimResult = { ok: true } | { ok: false; error: string };

function normalizeCode(code: string) {
  return code.replace(/\s+/g, "");
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function validateSignupCode(
  code: string,
  email: string,
): Promise<SignupCodeValidateResult> {
  const normalizedCode = normalizeCode(code);
  const normalizedEmail = normalizeEmail(email);

  const supabase = createSupabaseServiceClient();
  if (!supabase) return { state: "invalid_or_used" };

  const { data, error } = await supabase
    .from("signup_codes")
    .select("code, used_at, used_email, confirmed_at")
    .eq("code", normalizedCode)
    .maybeSingle();

  if (error || !data) return { state: "invalid_or_used" };

  if (data.used_at === null) {
    return { state: "unused" };
  }

  const matchesEmail =
    typeof data.used_email === "string" &&
    data.used_email.toLowerCase() === normalizedEmail;

  if (!matchesEmail) return { state: "invalid_or_used" };

  if (data.confirmed_at !== null) {
    return { state: "already_confirmed_same_email" };
  }

  return { state: "pending_same_email" };
}

export async function claimSignupCode(
  code: string,
  userId: string,
  email: string,
): Promise<SignupCodeClaimResult> {
  const normalizedCode = normalizeCode(code);
  const normalizedEmail = normalizeEmail(email);

  const supabase = createSupabaseServiceClient();
  if (!supabase) return { ok: false, error: "no_supabase" };

  const { data, error } = await supabase
    .from("signup_codes")
    .update({
      used_by: userId,
      used_email: normalizedEmail,
      used_at: new Date().toISOString(),
    })
    .eq("code", normalizedCode)
    .is("used_at", null)
    .select("code")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "already_claimed" };

  return { ok: true };
}

export async function markSignupCodeConfirmed(userId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    console.warn(
      `[signup-code] markSignupCodeConfirmed: no service client (user=${userId})`,
    );
    return;
  }

  const { data, error } = await supabase
    .from("signup_codes")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("used_by", userId)
    .is("confirmed_at", null)
    .select("code");

  if (error) {
    console.error(
      `[signup-code] markSignupCodeConfirmed failed for user ${userId}: ${error.message}`,
    );
    return;
  }

  if (!data || data.length === 0) {
    console.warn(
      `[signup-code] markSignupCodeConfirmed: no rows updated for user ${userId} (already confirmed or no claimed code)`,
    );
    return;
  }

  console.log(
    `[signup-code] markSignupCodeConfirmed: confirmed ${data.length} row(s) for user ${userId}`,
  );
}
