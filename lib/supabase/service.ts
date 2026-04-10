import { createClient } from "@supabase/supabase-js";

/**
 * Creates a Supabase client using the service role key.
 * This client bypasses RLS and can query across all users.
 * Only use in researcher/admin routes that have already verified
 * the caller is an authorised researcher.
 */
export function createSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
