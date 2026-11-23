import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
  type User,
} from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  SUPABASE_AUTH_UNAVAILABLE_MESSAGE,
  classifySupabaseAuthError,
  getSupabaseUser,
} from "./auth";

const user = { id: "user-1" } as User;

function clientReturning(result: { data: { user: User | null }; error?: unknown }) {
  return { auth: { getUser: async () => result } };
}

describe("getSupabaseUser", () => {
  it("returns the user with no error", async () => {
    const result = await getSupabaseUser(
      clientReturning({ data: { user }, error: null }),
    );
    expect(result).toEqual({ user, error: null, cause: null });
  });

  it("surfaces a returned auth error as cause, keeping error null", async () => {
    const retryable = new AuthRetryableFetchError("fetch failed", 0);
    const result = await getSupabaseUser(
      clientReturning({ data: { user: null }, error: retryable }),
    );
    expect(result.user).toBeNull();
    expect(result.error).toBeNull();
    expect(result.cause).toBe(retryable);
  });

  it("treats a client without an error field as no error", async () => {
    const result = await getSupabaseUser(clientReturning({ data: { user: null } }));
    expect(result).toEqual({ user: null, error: null, cause: null });
  });

  it("formats thrown errors and exposes them as cause", async () => {
    const thrown = new TypeError("fetch failed");
    const result = await getSupabaseUser({
      auth: {
        getUser: async () => {
          throw thrown;
        },
      },
    });
    expect(result).toEqual({
      user: null,
      error: SUPABASE_AUTH_UNAVAILABLE_MESSAGE,
      cause: thrown,
    });
  });
});

describe("classifySupabaseAuthError", () => {
  it("returns none without an error", () => {
    expect(classifySupabaseAuthError(null)).toBe("none");
    expect(classifySupabaseAuthError(undefined)).toBe("none");
  });

  it.each([0, 502, 503, 504])(
    "treats AuthRetryableFetchError status %i as transient",
    (status) => {
      expect(
        classifySupabaseAuthError(new AuthRetryableFetchError("down", status)),
      ).toBe("transient");
    },
  );

  it("treats a thrown fetch failure as transient", () => {
    expect(classifySupabaseAuthError(new TypeError("fetch failed"))).toBe(
      "transient",
    );
  });

  it("reports a missing session", () => {
    expect(classifySupabaseAuthError(new AuthSessionMissingError())).toBe(
      "session_missing",
    );
  });

  it.each([
    "refresh_token_not_found",
    "refresh_token_already_used",
    "session_not_found",
    "session_expired",
    "bad_jwt",
    "user_not_found",
  ])("treats AuthApiError %s as an invalid session", (code) => {
    expect(
      classifySupabaseAuthError(new AuthApiError("rejected", 400, code)),
    ).toBe("invalid_session");
  });

  it.each([
    new AuthApiError("Internal error", 500, "unexpected_failure"),
    new AuthApiError("Too many requests", 429, "over_request_rate_limit"),
    new AuthApiError("Invalid Refresh Token", 400, undefined),
    new AuthUnknownError("bad json", new SyntaxError("x")),
    new Error("boom"),
    "boom",
  ])("treats %o as unknown", (error) => {
    expect(classifySupabaseAuthError(error)).toBe("unknown");
  });
});
