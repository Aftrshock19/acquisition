import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  type User,
} from "@supabase/supabase-js";
import { NextRequest, type NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CookieToSet = { name: string; value: string; options: object };
type CookieAdapter = {
  getAll(): { name: string; value: string }[];
  setAll(cookies: CookieToSet[]): void;
};

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getSupabaseUser: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

vi.mock("@/lib/supabase/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/auth")>()),
  getSupabaseUser: mocks.getSupabaseUser,
}));

import { proxy } from "./proxy";

const SESSION = "sb-ref-auth-token";
const SESSION_CHUNK_0 = "sb-ref-auth-token.0";
const SESSION_CHUNK_1 = "sb-ref-auth-token.1";
const VERIFIER = "sb-ref-auth-token-code-verifier";

let cookieAdapter: CookieAdapter | null = null;

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

function authResult(cause: unknown, user: User | null = null) {
  return { user, error: null, cause };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  cookieAdapter = null;
  mocks.createServerClient.mockImplementation(
    (_url: string, _key: string, options: { cookies: CookieAdapter }) => {
      cookieAdapter = options.cookies;
      return { auth: {} };
    },
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.createServerClient.mockReset();
  mocks.getSupabaseUser.mockReset();
});

describe("proxy auth cookie handling", () => {
  it("leaves cookies untouched for a valid user", async () => {
    mocks.getSupabaseUser.mockResolvedValue(
      authResult(null, { id: "user-1" } as User),
    );
    const request = makeRequest({ [SESSION]: "s", [VERIFIER]: "v" });

    const response = await proxy(request);

    expect(response.cookies.getAll()).toEqual([]);
    expect(request.cookies.has(SESSION)).toBe(true);
    expect(request.cookies.has(VERIFIER)).toBe(true);
  });

  it.each([
    ["network failure", new AuthRetryableFetchError("fetch failed", 0)],
    ["503 from Supabase Auth", new AuthRetryableFetchError("unavailable", 503)],
    ["unrecognised 500", new AuthApiError("boom", 500, "unexpected_failure")],
  ])("keeps session cookies and logs on %s", async (_label, cause) => {
    mocks.getSupabaseUser.mockResolvedValue(authResult(cause));
    const request = makeRequest({ [SESSION_CHUNK_0]: "a", [SESSION_CHUNK_1]: "b" });

    const response = await proxy(request);

    expect(deletedCookies(response)).toEqual([]);
    expect(request.cookies.has(SESSION_CHUNK_0)).toBe(true);
    expect(request.cookies.has(SESSION_CHUNK_1)).toBe(true);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("[proxy] supabase auth unavailable"),
      expect.anything(),
    );
  });

  it.each([
    "refresh_token_not_found",
    "refresh_token_already_used",
    "bad_jwt",
    "user_not_found",
  ])("clears session cookies but keeps the verifier on %s", async (code) => {
    mocks.getSupabaseUser.mockResolvedValue(
      authResult(new AuthApiError("Invalid Refresh Token", 400, code)),
    );
    const request = makeRequest({
      [SESSION_CHUNK_0]: "a",
      [SESSION_CHUNK_1]: "b",
      [VERIFIER]: "v",
    });

    const response = await proxy(request);

    expect(deletedCookies(response)).toEqual([SESSION_CHUNK_0, SESSION_CHUNK_1]);
    expect(request.cookies.has(SESSION_CHUNK_0)).toBe(false);
    expect(request.cookies.has(SESSION_CHUNK_1)).toBe(false);
    expect(request.cookies.has(VERIFIER)).toBe(true);
  });

  it("clears an unusable session cookie when the session is missing", async () => {
    mocks.getSupabaseUser.mockResolvedValue(
      authResult(new AuthSessionMissingError()),
    );
    const request = makeRequest({ [SESSION_CHUNK_1]: "orphan", [VERIFIER]: "v" });

    const response = await proxy(request);

    expect(deletedCookies(response)).toEqual([SESSION_CHUNK_1]);
    expect(request.cookies.has(VERIFIER)).toBe(true);
  });

  it("never touches a verifier-only visitor (mid sign-up)", async () => {
    const request = makeRequest({ [VERIFIER]: "v", other: "x" });

    const response = await proxy(request);

    expect(mocks.getSupabaseUser).not.toHaveBeenCalled();
    expect(response.cookies.getAll()).toEqual([]);
    expect(request.cookies.has(VERIFIER)).toBe(true);
  });

  it("skips the auth check without any Supabase cookie", async () => {
    const response = await proxy(makeRequest({ other: "x" }));

    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(response.cookies.getAll()).toEqual([]);
  });

  it("propagates refreshed cookies to request and response", async () => {
    mocks.getSupabaseUser.mockImplementation(async () => {
      cookieAdapter!.setAll([
        { name: SESSION, value: "refreshed", options: { path: "/" } },
      ]);
      return authResult(null, { id: "user-1" } as User);
    });
    const request = makeRequest({ [SESSION]: "old" });

    const response = await proxy(request);

    expect(request.cookies.get(SESSION)?.value).toBe("refreshed");
    expect(response.cookies.get(SESSION)?.value).toBe("refreshed");
  });

  it.each([
    ["unrecognised 500", new AuthApiError("boom", 500, "unexpected_failure")],
    ["network failure", new AuthRetryableFetchError("fetch failed", 0)],
  ])(
    "discards the sign-out auth-js issues before a %s",
    async (_label, cause) => {
      // auth-js runs _removeSession() after any non-retryable refresh error.
      mocks.getSupabaseUser.mockImplementation(async () => {
        cookieAdapter!.setAll([
          { name: SESSION, value: "", options: { maxAge: 0 } },
          { name: VERIFIER, value: "", options: { maxAge: 0 } },
        ]);
        return authResult(cause);
      });
      const request = makeRequest({ [SESSION]: "s", [VERIFIER]: "v" });

      const response = await proxy(request);

      expect(response.cookies.getAll()).toEqual([]);
      expect(request.cookies.get(SESSION)?.value).toBe("s");
      expect(request.cookies.get(VERIFIER)?.value).toBe("v");
      expect(response.headers.get("x-middleware-request-cookie")).toContain(
        `${SESSION}=s`,
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("discarded auth-js sign-out"),
        expect.anything(),
      );
    },
  );

  it("keeps a rotated session's chunk cleanup when a later call fails", async () => {
    mocks.getSupabaseUser.mockImplementation(async () => {
      cookieAdapter!.setAll([
        { name: SESSION_CHUNK_0, value: "", options: { maxAge: 0 } },
        { name: SESSION_CHUNK_1, value: "", options: { maxAge: 0 } },
        { name: SESSION, value: "rotated", options: { path: "/" } },
      ]);
      return authResult(new AuthApiError("boom", 500, "unexpected_failure"));
    });
    const request = makeRequest({ [SESSION_CHUNK_0]: "a", [SESSION_CHUNK_1]: "b" });

    const response = await proxy(request);

    expect(deletedCookies(response)).toEqual([SESSION_CHUNK_0, SESSION_CHUNK_1]);
    expect(response.cookies.get(SESSION)?.value).toBe("rotated");
    expect(request.cookies.get(SESSION)?.value).toBe("rotated");
  });

  it("forwards the cleared cookies to server components on the same request", async () => {
    mocks.getSupabaseUser.mockResolvedValue(
      authResult(new AuthApiError("invalid JWT", 403, "bad_jwt")),
    );
    const request = makeRequest({ [SESSION]: "stale", [VERIFIER]: "v" });

    const response = await proxy(request);

    const forwarded = response.headers.get("x-middleware-request-cookie") ?? "";
    expect(forwarded).not.toContain(`${SESSION}=`);
    expect(forwarded).toContain(`${VERIFIER}=v`);
  });

  it("lets auth-js read its own earlier writes in the same request", async () => {
    let seen: { name: string; value: string }[] = [];
    mocks.getSupabaseUser.mockImplementation(async () => {
      cookieAdapter!.setAll([
        { name: SESSION, value: "refreshed", options: { path: "/" } },
      ]);
      seen = cookieAdapter!.getAll();
      return authResult(null, { id: "user-1" } as User);
    });

    await proxy(makeRequest({ [SESSION]: "old" }));

    expect(seen).toEqual([{ name: SESSION, value: "refreshed" }]);
  });

  it("drops a verifier removal issued by auth-js while invalidating a session", async () => {
    mocks.getSupabaseUser.mockImplementation(async () => {
      cookieAdapter!.setAll([
        { name: SESSION, value: "", options: { maxAge: 0 } },
        { name: VERIFIER, value: "", options: { maxAge: 0 } },
      ]);
      return authResult(
        new AuthApiError("Invalid Refresh Token", 400, "refresh_token_not_found"),
      );
    });
    const request = makeRequest({ [SESSION]: "stale", [VERIFIER]: "v" });

    const response = await proxy(request);

    expect(deletedCookies(response)).toEqual([SESSION]);
    expect(request.cookies.get(VERIFIER)?.value).toBe("v");
  });
});
