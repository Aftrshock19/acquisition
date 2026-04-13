import { describe, it, expect } from "vitest";
import { splitIntoChunks } from "./synthesize";

describe("splitIntoChunks", () => {
  it("returns single chunk when text fits", () => {
    const text = "Hola mundo.";
    expect(splitIntoChunks(text, 5000)).toEqual([text]);
  });

  it("splits on sentence boundaries", () => {
    const s1 = "Primera oración. ";
    const s2 = "Segunda oración. ";
    const s3 = "Tercera oración.";
    // Set maxBytes to fit two sentences but not three
    const twoSentenceBytes = Buffer.byteLength(s1 + s2, "utf-8");
    const chunks = splitIntoChunks(s1 + s2 + s3, twoSentenceBytes);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toContain("Primera");
    expect(chunks[0]).toContain("Segunda");
    expect(chunks[1]).toContain("Tercera");
  });

  it("preserves all text content across chunks", () => {
    const text = "A. B. C. D. E. F.";
    const chunks = splitIntoChunks(text, 10);
    const rejoined = chunks.join(" ");
    // All original sentences should be present
    expect(rejoined).toContain("A.");
    expect(rejoined).toContain("F.");
  });

  it("handles text with no sentence boundaries", () => {
    const text = "abcdefghij klmnopqrst";
    const chunks = splitIntoChunks(text, 12);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.join(" ")).toContain("abcdefghij");
    expect(chunks.join(" ")).toContain("klmnopqrst");
  });

  it("handles Spanish accented characters in byte counting", () => {
    // "ñ" is 2 bytes in UTF-8
    const text = "ñ".repeat(2500);
    // 2500 × 2 = 5000 bytes, which exceeds 4800
    const chunks = splitIntoChunks(text, 4800);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const totalBytes = chunks.reduce(
      (sum, c) => sum + Buffer.byteLength(c, "utf-8"),
      0,
    );
    expect(totalBytes).toBe(Buffer.byteLength(text, "utf-8"));
  });

  it("handles empty-ish strings", () => {
    expect(splitIntoChunks("Hola.", 5000)).toEqual(["Hola."]);
  });
});
