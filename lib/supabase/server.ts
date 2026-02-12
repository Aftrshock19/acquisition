import type { cookies as CookiesFn } from "next/headers";

export type SupabaseServerClientLike = {
  cookies?: ReturnType<typeof CookiesFn>;
  auth?: unknown;
};

export function createSupabaseServerClient(
  cookieStore?: ReturnType<typeof CookiesFn>,
): SupabaseServerClientLike {
  return { cookies: cookieStore };
}

