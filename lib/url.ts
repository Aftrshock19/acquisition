/**
 * Returns the canonical app URL for auth redirects.
 *
 * Priority:
 *   1. NEXT_PUBLIC_APP_URL env var (set in production & preview)
 *   2. VERCEL_URL (auto-set by Vercel for preview deploys)
 *   3. http://localhost:3000 (local development fallback)
 *
 * The result never has a trailing slash.
 */
export function getAppUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`.replace(/\/+$/, "");
  }

  return "http://localhost:3000";
}

/**
 * Returns `path` when it is a same-origin relative path that is safe to
 * redirect to (e.g. a user-supplied `?next=`), otherwise "/".
 *
 * A bare startsWith("/") check is not enough: the URL parser resolves
 * "//evil.com", "/\evil.com" and "/<tab>/evil.com" to another host.
 */
export function getSafeRedirectPath(
  path: string | null | undefined,
  origin: string = getAppUrl(),
): string {
  const fallback = "/";
  if (typeof path !== "string" || !path.startsWith("/")) return fallback;
  if (path.startsWith("//")) return fallback;
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    // Control characters (stripped by the parser) and backslashes (read as
    // "/" for http(s) URLs).
    if (code < 0x20 || code === 0x7f || code === 0x5c) return fallback;
  }

  let base: URL;
  let resolved: URL;
  try {
    base = new URL(origin);
    resolved = new URL(path, base);
  } catch {
    return fallback;
  }
  if (resolved.origin !== base.origin) return fallback;
  // "/.//evil.com" normalises to the pathname "//evil.com", which would turn
  // protocol-relative if anything re-resolved the normalised form.
  if (resolved.pathname.startsWith("//")) return fallback;
  return path;
}
