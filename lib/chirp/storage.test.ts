import { describe, it, expect } from "vitest";
import {
  audioStoragePath,
  storagePublicUrl,
  passageFilenameToStoragePath,
  LISTENING_AUDIO_BUCKET,
} from "./storage";

describe("audioStoragePath", () => {
  it("builds deterministic text-id-based path", () => {
    expect(audioStoragePath("abc-123", "support")).toBe(
      "audio/es-ES/abc-123/support.mp3",
    );
  });

  it("uses custom language code", () => {
    expect(audioStoragePath("abc-123", "transfer", "en-US")).toBe(
      "audio/en-US/abc-123/transfer.mp3",
    );
  });

  it("defaults to es-ES", () => {
    const path = audioStoragePath("xyz", "support");
    expect(path).toContain("es-ES");
  });
});

describe("storagePublicUrl", () => {
  it("builds the correct public URL", () => {
    const url = storagePublicUrl(
      "https://abc.supabase.co",
      "audio/es-ES/xyz/support.mp3",
    );
    expect(url).toBe(
      `https://abc.supabase.co/storage/v1/object/public/${LISTENING_AUDIO_BUCKET}/audio/es-ES/xyz/support.mp3`,
    );
  });
});

describe("passageFilenameToStoragePath (legacy)", () => {
  it("converts .txt filename to variant/base.mp3", () => {
    expect(
      passageFilenameToStoragePath("a1_short_stage1_passage1.txt", "support"),
    ).toBe("support/a1_short_stage1_passage1.mp3");
  });

  it("handles filename without .txt extension", () => {
    expect(
      passageFilenameToStoragePath("a1_short_stage1_passage1", "support"),
    ).toBe("support/a1_short_stage1_passage1.mp3");
  });
});
