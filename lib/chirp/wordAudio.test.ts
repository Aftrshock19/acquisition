import { describe, it, expect } from "vitest";
import { wordAudioStoragePath } from "./storage";
import {
  canonicalWordSentence,
  localDirnameForVariant,
  sanitizeLemma,
  wordAudioLocalFilename,
  wordAudioPathColumn,
  wordAudioUrls,
} from "./wordAudio";

describe("wordAudioStoragePath", () => {
  it("builds deterministic lemma path", () => {
    expect(wordAudioStoragePath("abc-123", "lemma")).toBe(
      "audio/es-ES/words/abc-123/lemma.mp3",
    );
  });

  it("builds deterministic sentence path", () => {
    expect(wordAudioStoragePath("abc-123", "lemma-sentence")).toBe(
      "audio/es-ES/words/abc-123/lemma-sentence.mp3",
    );
  });

  it("respects language code override", () => {
    expect(wordAudioStoragePath("x", "lemma", "en-US")).toBe(
      "audio/en-US/words/x/lemma.mp3",
    );
  });
});

describe("wordAudioPathColumn", () => {
  it("maps lemma variant to lemma_audio_path", () => {
    expect(wordAudioPathColumn("lemma")).toBe("lemma_audio_path");
  });

  it("maps lemma-sentence variant to lemma_sentence_audio_path", () => {
    expect(wordAudioPathColumn("lemma-sentence")).toBe(
      "lemma_sentence_audio_path",
    );
  });
});

describe("canonicalWordSentence", () => {
  it("returns trimmed sentence when present", () => {
    expect(canonicalWordSentence({ example_sentence: "  Hola.  " })).toBe(
      "Hola.",
    );
  });

  it("returns null for missing sentence", () => {
    expect(canonicalWordSentence({ example_sentence: null })).toBeNull();
  });

  it("returns null for empty / whitespace sentence", () => {
    expect(canonicalWordSentence({ example_sentence: "   " })).toBeNull();
    expect(canonicalWordSentence({ example_sentence: "" })).toBeNull();
  });
});

describe("sanitizeLemma", () => {
  it("lowercases", () => {
    expect(sanitizeLemma("DE")).toBe("de");
  });
  it("preserves hyphens and accents", () => {
    expect(sanitizeLemma("mañana-azul")).toBe("mañana-azul");
  });
  it("replaces whitespace with underscore", () => {
    expect(sanitizeLemma("por favor")).toBe("por_favor");
  });
  it("strips leading/trailing punctuation", () => {
    expect(sanitizeLemma("¿qué?")).toBe("qué");
    expect(sanitizeLemma("  hola!  ")).toBe("hola");
  });
});

describe("wordAudioLocalFilename", () => {
  it("builds rank-lemma.mp3", () => {
    expect(wordAudioLocalFilename(1, "de")).toBe("1-de.mp3");
  });
  it("appends collision suffix", () => {
    expect(wordAudioLocalFilename(1, "de", "abc123")).toBe("1-de__abc123.mp3");
  });
  it("sanitizes punctuation", () => {
    expect(wordAudioLocalFilename(42, "¿Qué?")).toBe("42-qué.mp3");
  });
});

describe("localDirnameForVariant", () => {
  it("lemma → word-audio", () => {
    expect(localDirnameForVariant("lemma")).toBe("word-audio");
  });
  it("lemma-sentence → sentence-audio", () => {
    expect(localDirnameForVariant("lemma-sentence")).toBe("sentence-audio");
  });
});

describe("wordAudioUrls", () => {
  const supabaseUrl = "https://proj.supabase.co";

  it("returns null urls when paths are missing", () => {
    expect(
      wordAudioUrls(
        { lemma_audio_path: null, lemma_sentence_audio_path: null },
        supabaseUrl,
      ),
    ).toEqual({ lemmaUrl: null, sentenceUrl: null });
  });

  it("builds public URLs from stored paths", () => {
    const { lemmaUrl, sentenceUrl } = wordAudioUrls(
      {
        lemma_audio_path: "audio/es-ES/words/w1/lemma.mp3",
        lemma_sentence_audio_path: "audio/es-ES/words/w1/lemma-sentence.mp3",
      },
      supabaseUrl,
    );
    expect(lemmaUrl).toBe(
      "https://proj.supabase.co/storage/v1/object/public/listening-audio/audio/es-ES/words/w1/lemma.mp3",
    );
    expect(sentenceUrl).toBe(
      "https://proj.supabase.co/storage/v1/object/public/listening-audio/audio/es-ES/words/w1/lemma-sentence.mp3",
    );
  });

  it("returns partial urls when only one path is populated", () => {
    const urls = wordAudioUrls(
      {
        lemma_audio_path: "audio/es-ES/words/w2/lemma.mp3",
        lemma_sentence_audio_path: null,
      },
      supabaseUrl,
    );
    expect(urls.lemmaUrl).toContain("/w2/lemma.mp3");
    expect(urls.sentenceUrl).toBeNull();
  });
});
