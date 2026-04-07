import { describe, expect, it } from "vitest";
import { formatPartOfSpeech } from "./partOfSpeech";

describe("formatPartOfSpeech", () => {
  it("expands abbreviated part of speech codes", () => {
    expect(formatPartOfSpeech("art")).toBe("Article");
    expect(formatPartOfSpeech("adj")).toBe("Adjective");
    expect(formatPartOfSpeech("pron")).toBe("Pronoun");
  });

  it("preserves unknown labels in title case", () => {
    expect(formatPartOfSpeech("proper noun")).toBe("Proper Noun");
    expect(formatPartOfSpeech("custom tag")).toBe("Custom Tag");
  });

  it("returns null for empty values", () => {
    expect(formatPartOfSpeech("")).toBeNull();
    expect(formatPartOfSpeech(null)).toBeNull();
  });
});
