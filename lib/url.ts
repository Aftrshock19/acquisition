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
