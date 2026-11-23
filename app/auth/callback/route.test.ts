import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  shouldRedirectToIntro: vi.fn(),
  shouldRedirectToPlacement: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      exchangeCodeForSession: mocks.exchangeCodeForSession,
      getUser: mocks.getUser,
      verifyOtp: mocks.verifyOtp,
      signOut: mocks.signOut,
    },
  }),
}));

vi.mock("@/lib/onboarding/state", () => ({
  shouldRedirectToIntro: mocks.shouldRedirectToIntro,
  shouldRedirectToPlacement: mocks.shouldRedirectToPlacement,
}));

import { GET as callback } from "./route";
import { GET as confirm } from "../confirm/route";

const ORIGIN = "https://languageacquisition.net";

function get(path: string) {
  return new NextRequest(`${ORIGIN}${path}`);
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
  mocks.shouldRedirectToIntro.mockResolvedValue(false);
  mocks.shouldRedirectToPlacement.mockResolvedValue(false);
  mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  Object.values(mocks).forEach((m) => m.mockReset());
});

describe("/auth/callback next redirect", () => {
  it.each([
    "//evil.com",
    "/\\evil.com",
    "///evil.com",
    "https://evil.com",
    "/\t/evil.com",
  ])("does not redirect off-site for next=%j", async (next) => {
    const response = await callback(
      get(`/auth/callback?next=${encodeURIComponent(next)}`),
    );
    expect(response.headers.get("location")).toBe(`${ORIGIN}/`);
  });

  it("keeps a same-origin next path with its query string", async () => {
    const response = await callback(
      get(`/auth/callback?code=abc&next=${encodeURIComponent("/today?tab=review")}`),
    );
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/today?tab=review`);
  });

  it("sends a failed exchange to /login with an error code, not text", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      error: new Error("PKCE code verifier not found in storage"),
    });
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await callback(get("/auth/callback?code=abc"));

    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(`${ORIGIN}/login`);
    expect(location.searchParams.get("error")).toBe("link_invalid");
  });

  it("maps a provider error to the error code", async () => {
    const response = await callback(
      get("/auth/callback?error_description=Email+link+is+invalid"),
    );
    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("error")).toBe("link_invalid");
  });
});

describe("/auth/confirm error redirect", () => {
  it("uses the error code when the token is missing", async () => {
    const response = await confirm(get("/auth/confirm"));
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("link_invalid");
  });

  it("uses the error code when verification fails", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: new Error("Token has expired") });
    const response = await confirm(get("/auth/confirm?token_hash=abc&type=email"));
    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("error")).toBe("link_invalid");
  });
});
