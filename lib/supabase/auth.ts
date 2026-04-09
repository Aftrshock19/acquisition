import type { User } from "@supabase/supabase-js";

type SupabaseAuthClient = {
  auth: {
    getUser(): Promise<{
      data: { user: User | null };
    }>;
  };
};

export const SUPABASE_AUTH_UNAVAILABLE_MESSAGE =
  "Couldn't reach Supabase auth. Check NEXT_PUBLIC_SUPABASE_URL, your network connection, or whether the Supabase project is available.";

export async function getSupabaseUser(
  supabase: SupabaseAuthClient,
): Promise<{ user: User | null; error: string | null }> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    return { user, error: null };
  } catch (error) {
    return {
      user: null,
      error: formatSupabaseAuthError(error),
    };
  }
}

export function formatSupabaseAuthError(error: unknown) {
  if (error instanceof TypeError && error.message === "fetch failed") {
    return SUPABASE_AUTH_UNAVAILABLE_MESSAGE;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return SUPABASE_AUTH_UNAVAILABLE_MESSAGE;
}
