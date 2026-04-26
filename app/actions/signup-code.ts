"use server";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

export type SignupCodeResult = { ok: true } | { ok: false; error: string };

export async function validateSignupCode(code: string): Promise<SignupCodeResult> {
  const normalized = code.replace(/\s+/g, "");

  const supabase = createSupabaseServiceClient();
  if (!supabase) return { ok: false, error: "no_supabase" };

  const { data, error } = await supabase
    .from("signup_codes")
    .select("code")
    .eq("code", normalized)
    .is("used_at", null)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "invalid_code" };

  return { ok: true };
}

export async function claimSignupCode(
  code: string,
  userId: string,
): Promise<SignupCodeResult> {
  const normalized = code.replace(/\s+/g, "");

  const supabase = createSupabaseServiceClient();
  if (!supabase) return { ok: false, error: "no_supabase" };

  const { data, error } = await supabase
    .from("signup_codes")
    .update({ used_by: userId, used_at: new Date().toISOString() })
    .eq("code", normalized)
    .is("used_at", null)
    .select("code")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "already_claimed" };

  return { ok: true };
}
