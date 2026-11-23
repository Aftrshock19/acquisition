// Drives the proxy against the real @supabase/ssr + auth-js clients with a
// stubbed fetch, so cookie writes that auth-js makes on its own (e.g. the
// _removeSession() it runs after any non-retryable refresh failure) are
// covered, not just the classification of the returned error.
import type { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

const SESSION = "sb-ref-auth-token";
const VERIFIER = "sb-ref-auth-token-code-verifier";

const user = { id: "user-1", aud: "authenticated", role: "authenticated" };

function encodeSession(session: object) {
  return `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

function expiredSessionCookie(extra: object = {}) {
  return encodeSession({
    access_token: "old-access",
    refresh_token: "old-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) - 60,
    user: { ...user, ...extra },
  });
}

function makeRequest(cookies: Record<string, string>) {
  return new NextRequest("https://languageacquisition.net/today", {
    headers: {
      cookie: Object.entries(cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join("; "),
    },
  });
}

function deletedCookies(response: NextResponse) {
  return response.cookies
    .getAll()
    .filter((c) => c.value === "")
    .map((c) => c.name)
    .sort();
}

function json(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-supabase-api-version": "2024-01-01",
    },
  });
}

function stubAuthServer(routes: { token: () => Response; user?: () => Response }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/auth/v1/token")) return routes.token();
    if (url.includes("/auth/v1/user") && routes.user) return routes.user();
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("proxy with the real Supabase client (expired access token)", () => {
  it.each([
    [
      "a 500 unexpected_failure",
      () => json(500, { code: "unexpected_failure", msg: "boom" }),
    ],
    [
      "a Cloudflare 522 HTML page",
      () =>
        new Response("<html>522: Connection timed out</html>", {
          status: 522,
          headers: { "content-type": "text/html" },
        }),
    ],
  ])("keeps the session when refresh fails with %s", async (_label, token) => {
    stubAuthServer({ token });
    const cookie = expiredSessionCookie();
    const request = makeRequest({ [SESSION]: cookie, [VERIFIER]: "v" });

    const response = await proxy(request);

    expect(deletedCookies(response)).toEqual([]);
    expect(request.cookies.get(SESSION)?.value).toBe(cookie);
    expect(request.cookies.get(VERIFIER)?.value).toBe("v");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("keeping session cookies"),
      expect.anything(),
    );
  });

  it("clears the session but keeps the verifier on refresh_token_not_found", async () => {
    stubAuthServer({
      token: () =>
        json(400, {
          code: "refresh_token_not_found",
          msg: "Invalid Refresh Token: Refresh Token Not Found",
        }),
    });
    const request = makeRequest({
      [SESSION]: expiredSessionCookie(),
      [VERIFIER]: "v",
    });

    const response = await proxy(request);

    expect(deletedCookies(response)).toEqual([SESSION]);
    expect(request.cookies.has(SESSION)).toBe(false);
    expect(request.cookies.get(VERIFIER)?.value).toBe("v");
  });

  it("stores a rotated session even when the follow-up /user call fails", async () => {
    const refreshed = {
      access_token: "new-access",
      refresh_token: "new-refresh",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user,
    };
    stubAuthServer({
      token: () => json(200, refreshed),
      user: () => json(500, { code: "unexpected_failure", msg: "boom" }),
    });
    // A large old session is stored in chunks; the smaller rotated one fits
    // in a single cookie, so the old chunks must be removed with it.
    const big = expiredSessionCookie({ padding: "x".repeat(4000) });
    const half = Math.ceil(big.length / 2);
    const request = makeRequest({
      [`${SESSION}.0`]: big.slice(0, half),
      [`${SESSION}.1`]: big.slice(half),
    });

    const response = await proxy(request);

    expect(deletedCookies(response)).toEqual([`${SESSION}.0`, `${SESSION}.1`]);
    const stored = response.cookies.get(SESSION)?.value ?? "";
    const decoded = JSON.parse(
      Buffer.from(stored.replace(/^base64-/, ""), "base64url").toString(),
    );
    expect(decoded.refresh_token).toBe("new-refresh");
    expect(request.cookies.get(SESSION)?.value).toBe(stored);
    expect(request.cookies.get(`${SESSION}.0`)?.value ?? "").toBe("");
  });

  it("propagates a successful refresh to request and response", async () => {
    stubAuthServer({
      token: () =>
        json(200, {
          access_token: "new-access",
          refresh_token: "new-refresh",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user,
        }),
      user: () => json(200, user),
    });
    const request = makeRequest({ [SESSION]: expiredSessionCookie() });

    const response = await proxy(request);

    const stored = response.cookies.get(SESSION)?.value;
    expect(stored).toMatch(/^base64-/);
    expect(stored).not.toBe(expiredSessionCookie());
    expect(request.cookies.get(SESSION)?.value).toBe(stored);
    expect(deletedCookies(response)).toEqual([]);
  });
});
