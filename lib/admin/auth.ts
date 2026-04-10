import type { User } from "@supabase/supabase-js";
import { getSupabaseUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ResearcherAuthResult =
  | { ok: true; user: User }
  | { ok: false; status: number; error: string };

/**
 * Verifies the caller is an authenticated user whose email is in the
 * RESEARCHER_EMAILS allowlist. Returns the user on success or an error
 * payload on failure.
 *
 * RESEARCHER_EMAILS is a comma-separated list of email addresses set in
 * the server environment (e.g., "alice@uni.ac.uk,bob@uni.ac.uk").
 */
export async function requireResearcher(): Promise<ResearcherAuthResult> {
  const allowlist = getResearcherEmails();
  if (allowlist.length === 0) {
    return {
      ok: false,
      status: 503,
      error: "RESEARCHER_EMAILS is not configured.",
    };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      ok: false,
      status: 503,
      error: "Supabase is not configured.",
    };
  }

  const { user, error: authError } = await getSupabaseUser(supabase);
  if (authError) {
    return { ok: false, status: 401, error: authError };
  }

  if (!user) {
    return { ok: false, status: 401, error: "Not authenticated." };
  }

  if (!user.email || !allowlist.includes(user.email.toLowerCase())) {
    return { ok: false, status: 403, error: "Not authorised as a researcher." };
  }

  return { ok: true, user };
}

function getResearcherEmails(): string[] {
  const raw = process.env.RESEARCHER_EMAILS ?? "";
  return raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}
