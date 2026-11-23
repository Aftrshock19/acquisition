import { describe, expect, it } from "vitest";
import {
  FLASHCARD_EXTEND_FALLBACK,
  FLASHCARD_SAVE_FALLBACK,
  LOGIN_ERROR_LINK_INVALID,
  loginErrorMessage,
  looksLikeRawInfraError,
  toSafeUserMessage,
} from "./userMessages";

describe("looksLikeRawInfraError", () => {
  it("flags raw Postgres CHECK constraint errors", () => {
    expect(
      looksLikeRawInfraError(
        'new row for relation "daily_sessions" violates check constraint "daily_sessions_completed_stage_check"',
      ),
    ).toBe(true);
  });

  it("flags raw Postgres unique-violation errors", () => {
    expect(
      looksLikeRawInfraError(
        'duplicate key value violates unique constraint "daily_sessions_user_date_unique"',
      ),
    ).toBe(true);
  });

  it("flags Postgrest 42703 column-not-found leaks", () => {
    expect(
      looksLikeRawInfraError(
        'column "completed_stage" does not exist',
      ),
    ).toBe(true);
  });

  it("does not flag short safe copy", () => {
    expect(looksLikeRawInfraError("Pick a number between 1 and 200.")).toBe(false);
    expect(looksLikeRawInfraError(null)).toBe(false);
  });
});

describe("toSafeUserMessage", () => {
  it("hides raw constraint errors behind the fallback", () => {
    expect(
      toSafeUserMessage(
        'new row for relation "daily_sessions" violates check constraint "daily_sessions_completed_stage_check"',
        FLASHCARD_EXTEND_FALLBACK,
      ),
    ).toBe(FLASHCARD_EXTEND_FALLBACK);
  });

  it("hides unique violations behind the fallback", () => {
    expect(
      toSafeUserMessage(
        'duplicate key value violates unique constraint "review_events_user_client_attempt_unique"',
        FLASHCARD_SAVE_FALLBACK,
      ),
    ).toBe(FLASHCARD_SAVE_FALLBACK);
  });

  it("returns null/empty as the fallback", () => {
    expect(toSafeUserMessage(null, FLASHCARD_SAVE_FALLBACK)).toBe(
      FLASHCARD_SAVE_FALLBACK,
    );
    expect(toSafeUserMessage("", FLASHCARD_SAVE_FALLBACK)).toBe(
      FLASHCARD_SAVE_FALLBACK,
    );
  });

  it("passes through short, ascii-only copy that doesn't look like infra", () => {
    expect(
      toSafeUserMessage("Sign in and try again.", FLASHCARD_SAVE_FALLBACK),
    ).toBe("Sign in and try again.");
  });

  it("falls back when the message contains SQL-ish punctuation", () => {
    expect(
      toSafeUserMessage('error: "table public.x" not found', FLASHCARD_SAVE_FALLBACK),
    ).toBe(FLASHCARD_SAVE_FALLBACK);
  });

  it("falls back when the message is unusually long", () => {
    const long = "a".repeat(200);
    expect(toSafeUserMessage(long, FLASHCARD_SAVE_FALLBACK)).toBe(
      FLASHCARD_SAVE_FALLBACK,
    );
  });
});

describe("loginErrorMessage", () => {
  it("maps the link_invalid code to the existing confirmation copy", () => {
    expect(loginErrorMessage(LOGIN_ERROR_LINK_INVALID)).toBe(
      "This confirmation link is no longer valid. Try signing in — if your email is already confirmed it will work. Otherwise, request a new confirmation email below. If you still cannot get in, email du22662@bristol.ac.uk.",
    );
  });

  it("ignores arbitrary text so links cannot inject copy", () => {
    expect(
      loginErrorMessage(
        "Your account is locked. Call +44 20 0000 0000 to unlock it.",
      ),
    ).toBeNull();
    expect(loginErrorMessage("LINK_INVALID")).toBeNull();
  });

  it("ignores prototype keys, arrays and missing values", () => {
    expect(loginErrorMessage("constructor")).toBeNull();
    expect(loginErrorMessage("__proto__")).toBeNull();
    expect(loginErrorMessage("toString")).toBeNull();
    expect(loginErrorMessage([LOGIN_ERROR_LINK_INVALID, "x"])).toBeNull();
    expect(loginErrorMessage(undefined)).toBeNull();
    expect(loginErrorMessage(null)).toBeNull();
    expect(loginErrorMessage("")).toBeNull();
  });
});
