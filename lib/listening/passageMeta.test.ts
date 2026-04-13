import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  extractTitleFromPassageFile,
  extractMetaFromJson,
  txtFilenameToJsonFilename,
  isGenericTitle,
  resolvePassageFilename,
} from "./passageMeta";

// ── extractTitleFromPassageFile ─────────────────────────────

describe("extractTitleFromPassageFile", () => {
  function writeTmpFile(content: string): string {
    const filePath = path.join(os.tmpdir(), `test-passage-${Date.now()}-${Math.random()}.txt`);
    fs.writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  it("extracts title from ---Title--- header", () => {
    const f = writeTmpFile("---Hoy es mi primer día---\nBody text here.");
    expect(extractTitleFromPassageFile(f)).toBe("Hoy es mi primer día");
    fs.unlinkSync(f);
  });

  it("handles title with spaces and accents", () => {
    const f = writeTmpFile("---La playa de mi niñez---\nContent.");
    expect(extractTitleFromPassageFile(f)).toBe("La playa de mi niñez");
    fs.unlinkSync(f);
  });

  it("returns null for missing file", () => {
    expect(extractTitleFromPassageFile("/nonexistent/file.txt")).toBeNull();
  });

  it("returns null for file without ---title--- format", () => {
    const f = writeTmpFile("Just regular text\nSecond line.");
    expect(extractTitleFromPassageFile(f)).toBeNull();
    fs.unlinkSync(f);
  });

  it("returns null for empty file", () => {
    const f = writeTmpFile("");
    expect(extractTitleFromPassageFile(f)).toBeNull();
    fs.unlinkSync(f);
  });

  it("returns null for --- only (no content between dashes)", () => {
    const f = writeTmpFile("------\nBody text.");
    expect(extractTitleFromPassageFile(f)).toBeNull();
    fs.unlinkSync(f);
  });
});

// ── extractMetaFromJson ─────────────────────────────────────

describe("extractMetaFromJson", () => {
  function writeTmpJson(data: unknown): string {
    const filePath = path.join(os.tmpdir(), `test-meta-${Date.now()}-${Math.random()}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data), "utf-8");
    return filePath;
  }

  it("extracts title and topic from JSON", () => {
    const f = writeTmpJson({ title: "La playa", topic: "a day at the beach" });
    expect(extractMetaFromJson(f)).toEqual({ title: "La playa", topic: "a day at the beach" });
    fs.unlinkSync(f);
  });

  it("returns nulls for missing file", () => {
    expect(extractMetaFromJson("/nonexistent/file.json")).toEqual({ title: null, topic: null });
  });

  it("returns nulls for JSON without title/topic", () => {
    const f = writeTmpJson({ other: "data" });
    expect(extractMetaFromJson(f)).toEqual({ title: null, topic: null });
    fs.unlinkSync(f);
  });

  it("trims whitespace", () => {
    const f = writeTmpJson({ title: "  La mañana  ", topic: "  morning routine  " });
    expect(extractMetaFromJson(f)).toEqual({ title: "La mañana", topic: "morning routine" });
    fs.unlinkSync(f);
  });

  it("returns null for empty string values", () => {
    const f = writeTmpJson({ title: "", topic: "" });
    expect(extractMetaFromJson(f)).toEqual({ title: null, topic: null });
    fs.unlinkSync(f);
  });
});

// ── txtFilenameToJsonFilename ───────────────────────────────

describe("txtFilenameToJsonFilename", () => {
  it("converts standard filename", () => {
    expect(txtFilenameToJsonFilename("a1_short_stage1_passage3.txt")).toBe("a1_short_stage1_3.json");
  });

  it("handles very_long mode", () => {
    expect(txtFilenameToJsonFilename("b2_very_long_stage16_passage2.txt")).toBe("b2_very_long_stage16_2.json");
  });

  it("returns null for non-matching filename", () => {
    expect(txtFilenameToJsonFilename("random_file.txt")).toBeNull();
  });

  it("returns null for JSON filename", () => {
    expect(txtFilenameToJsonFilename("a1_short_stage1_3.json")).toBeNull();
  });
});

// ── isGenericTitle ──────────────────────────────────────────

describe("isGenericTitle", () => {
  it("detects standard generic title", () => {
    expect(isGenericTitle("A1 Short – Stage 1 Passage 1")).toBe(true);
  });

  it("detects with Listening: prefix", () => {
    expect(isGenericTitle("Listening: A1 Short – Stage 1 Passage 1")).toBe(true);
  });

  it("detects lowercase generic", () => {
    expect(isGenericTitle("a1 short stage 1 passage 1")).toBe(true);
  });

  it("detects with em dash", () => {
    expect(isGenericTitle("B2 Very long — Stage 16 Passage 2")).toBe(true);
  });

  it("does not flag real human title", () => {
    expect(isGenericTitle("Hoy es mi primer día")).toBe(false);
  });

  it("does not flag Spanish title", () => {
    expect(isGenericTitle("La playa de mi niñez")).toBe(false);
  });

  it("does not flag short title", () => {
    expect(isGenericTitle("El café")).toBe(false);
  });
});

// ── resolvePassageFilename ──────────────────────────────────

describe("resolvePassageFilename", () => {
  it("builds correct filename", () => {
    expect(resolvePassageFilename("A1", "short", 1, 3)).toBe("a1_short_stage1_passage3.txt");
  });

  it("handles very_long mode", () => {
    expect(resolvePassageFilename("B2", "very_long", 16, 2)).toBe("b2_very_long_stage16_passage2.txt");
  });

  it("lowercases CEFR", () => {
    expect(resolvePassageFilename("C1", "medium", 21, 1)).toBe("c1_medium_stage21_passage1.txt");
  });
});
