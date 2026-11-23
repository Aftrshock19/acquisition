import { describe, expect, it } from "vitest";
import { getSafeRedirectPath } from "./url";

const ORIGIN = "https://languageacquisition.net";

describe("getSafeRedirectPath", () => {
  it.each([
    "/",
    "/today",
    "/onboarding",
    "/reader/abc-123",
    "/today?tab=review&x=1",
    "/progress#calendar",
    "/search?q=%2F%2Fevil.com",
    "/a//b",
  ])("keeps same-origin path %j", (path) => {
    expect(getSafeRedirectPath(path, ORIGIN)).toBe(path);
  });

  it.each([
    "//evil.com",
    "//evil.com/today",
    "/\\evil.com",
    "\\\\evil.com",
    "///evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r/evil.com",
    "/\u0000/evil.com",
    "/today\\..\\..\\",
    "/.//evil.com",
    "/..//evil.com",
    "/%2e//evil.com",
    "https://evil.com",
    "http:/evil.com",
    "javascript:alert(1)",
    "evil.com",
    "today",
    " /today",
  ])("rejects %j", (path) => {
    expect(getSafeRedirectPath(path, ORIGIN)).toBe("/");
  });

  it("falls back for missing values", () => {
    expect(getSafeRedirectPath(null, ORIGIN)).toBe("/");
    expect(getSafeRedirectPath(undefined, ORIGIN)).toBe("/");
    expect(getSafeRedirectPath("", ORIGIN)).toBe("/");
  });

  it("never resolves a kept path off-origin", () => {
    for (const path of ["/today?next=//evil.com", "/a//b", "/%2F%2Fevil.com"]) {
      const kept = getSafeRedirectPath(path, ORIGIN);
      expect(new URL(kept, ORIGIN).origin).toBe(ORIGIN);
    }
  });

  it("works with a localhost origin", () => {
    expect(getSafeRedirectPath("/today", "http://localhost:3000")).toBe(
      "/today",
    );
    expect(getSafeRedirectPath("//localhost:4000", "http://localhost:3000")).toBe(
      "/",
    );
  });
});
