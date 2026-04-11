import { describe, it, expect } from "vitest";
import { buildUnifiedQueue } from "./buildUnifiedQueue";
import type { TodaySession, DueReviewItem, Word } from "@/lib/srs/types";
import type { EnabledFlashcardMode } from "@/lib/settings/types";

function makeReview(id: string, rank = 1): DueReviewItem {
  return {
    id,
    word_id: id,
    user_id: "u1",
    language: "es",
    lemma: `lemma-${id}`,
    rank,
    translation: `trans-${id}`,
    definition: `def-${id}`,
    definitionEs: null,
    definitionEn: null,
    exampleSentence: `Sentence with ${id}`,
    exampleSentenceEn: `English sentence with ${id}`,
    status: "learning",
    pos: "noun",
  };
}

function makeNewWord(id: string, rank = 100): Word {
  return {
    id,
    language: "es",
    lemma: `lemma-${id}`,
    rank,
    translation: `trans-${id}`,
    definition: `def-${id}`,
    definitionEs: null,
    definitionEn: null,
    exampleSentence: `Sentence with ${id}`,
    exampleSentenceEn: `English sentence with ${id}`,
    pos: "noun",
  };
}

const ALL_MODES_ENABLED: Record<EnabledFlashcardMode, boolean> = {
  cloze_en_to_es: true,
  cloze_es_to_en: true,
  normal_en_to_es: true,
  normal_es_to_en: true,
  audio: true,
  mcq: true,
  sentences: true,
};

const CLOZE_ONLY: Record<EnabledFlashcardMode, boolean> = {
  cloze_en_to_es: true,
  cloze_es_to_en: false,
  normal_en_to_es: false,
  normal_es_to_en: false,
  audio: false,
  mcq: false,
  sentences: false,
};

function makeSession(reviews: DueReviewItem[], newWords: Word[]): TodaySession {
  return { dueReviews: reviews, newWords };
}

// ---------------------------------------------------------------------------
// No duplicate IDs in output
// ---------------------------------------------------------------------------
describe("no duplicate IDs in output", () => {
  it("reviews and new words with different IDs produce unique queue entries", () => {
    const session = makeSession(
      [makeReview("r1"), makeReview("r2"), makeReview("r3")],
      [makeNewWord("n1"), makeNewWord("n2")],
    );
    const { queue } = buildUnifiedQueue(session, ALL_MODES_ENABLED);

    const ids = queue.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it("same word_id in reviews and newWords is deduplicated — review wins", () => {
    const dupId = "word-dup";
    const session = makeSession(
      [makeReview(dupId)],
      [makeNewWord(dupId)],
    );
    const { queue } = buildUnifiedQueue(session, CLOZE_ONLY);

    const ids = queue.map((c) => c.id);
    // Dedup: only one card for this word_id
    expect(ids.filter((id) => id === dupId).length).toBe(1);
    // The review version wins (appears first in raw array)
    expect(queue[0].kind).toBe("review");
  });

  it("dedup with multiple overlapping IDs: each appears once, reviews win", () => {
    const session = makeSession(
      [makeReview("a"), makeReview("b"), makeReview("c")],
      [makeNewWord("b"), makeNewWord("c"), makeNewWord("d")],
    );
    const { queue } = buildUnifiedQueue(session, CLOZE_ONLY);

    const ids = queue.map((c) => c.id);
    expect(ids.length).toBe(4); // a, b, c, d — not 6
    expect(new Set(ids).size).toBe(4);
    // b and c should be reviews (first occurrence wins)
    const bCard = queue.find((c) => c.id === "b")!;
    const cCard = queue.find((c) => c.id === "c")!;
    expect(bCard.kind).toBe("review");
    expect(cCard.kind).toBe("review");
    // d should be new
    const dCard = queue.find((c) => c.id === "d")!;
    expect(dCard.kind).toBe("new");
  });

  it("dedup preserves deterministic order: reviews first, then new-only words", () => {
    const session = makeSession(
      [makeReview("r1"), makeReview("overlap")],
      [makeNewWord("overlap"), makeNewWord("n1")],
    );
    const { queue } = buildUnifiedQueue(session, CLOZE_ONLY);

    expect(queue.map((c) => c.id)).toEqual(["r1", "overlap", "n1"]);
    expect(queue.map((c) => c.kind)).toEqual(["review", "review", "new"]);
  });
});

// ---------------------------------------------------------------------------
// Ordering: reviews come before new words
// ---------------------------------------------------------------------------
describe("ordering", () => {
  it("reviews appear before new words in the queue", () => {
    const session = makeSession(
      [makeReview("r1"), makeReview("r2")],
      [makeNewWord("n1"), makeNewWord("n2")],
    );
    const { queue } = buildUnifiedQueue(session, CLOZE_ONLY);

    // The first entries should be reviews, then new words
    expect(queue[0].kind).toBe("review");
    expect(queue[1].kind).toBe("review");
    expect(queue[2].kind).toBe("new");
    expect(queue[3].kind).toBe("new");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe("edge cases", () => {
  it("empty session produces empty queue", () => {
    const { queue } = buildUnifiedQueue(makeSession([], []), ALL_MODES_ENABLED);
    expect(queue.length).toBe(0);
  });

  it("single review produces 1-card queue", () => {
    const { queue } = buildUnifiedQueue(
      makeSession([makeReview("solo")], []),
      CLOZE_ONLY,
    );
    expect(queue.length).toBe(1);
    expect(queue[0].id).toBe("solo");
    expect(queue[0].kind).toBe("review");
  });

  it("single new word produces 1-card queue", () => {
    const { queue } = buildUnifiedQueue(
      makeSession([], [makeNewWord("solo")]),
      CLOZE_ONLY,
    );
    expect(queue.length).toBe(1);
    expect(queue[0].id).toBe("solo");
    expect(queue[0].kind).toBe("new");
  });

  it("no enabled modes produces empty queue", () => {
    const noModes: Record<EnabledFlashcardMode, boolean> = {
      cloze_en_to_es: false,
      cloze_es_to_en: false,
      normal_en_to_es: false,
      normal_es_to_en: false,
      audio: false,
      mcq: false,
      sentences: false,
    };
    const { queue } = buildUnifiedQueue(
      makeSession([makeReview("r1")], [makeNewWord("n1")]),
      noModes,
    );
    expect(queue.length).toBe(0);
  });

  it("large queue: 50 reviews + 10 new words all present", () => {
    const reviews = Array.from({ length: 50 }, (_, i) => makeReview(`r${i}`));
    const newWords = Array.from({ length: 10 }, (_, i) => makeNewWord(`n${i}`));
    const { queue } = buildUnifiedQueue(makeSession(reviews, newWords), CLOZE_ONLY);

    expect(queue.length).toBe(60);
    const ids = new Set(queue.map((c) => c.id));
    expect(ids.size).toBe(60); // no duplicates
  });
});

// ---------------------------------------------------------------------------
// Card type assignment: modes cycle across cards
// ---------------------------------------------------------------------------
describe("card type cycling", () => {
  it("with 2 enabled modes, cards alternate between them", () => {
    const twoModes: Record<EnabledFlashcardMode, boolean> = {
      cloze_en_to_es: true,
      cloze_es_to_en: false,
      normal_en_to_es: false,
      normal_es_to_en: true,
      audio: false,
      mcq: false,
      sentences: false,
    };
    const session = makeSession(
      [makeReview("r1"), makeReview("r2"), makeReview("r3"), makeReview("r4")],
      [],
    );
    const { queue } = buildUnifiedQueue(session, twoModes);

    // Cards should alternate between the 2 enabled types
    expect(queue[0].cardType).not.toBe(queue[1].cardType);
    expect(queue[0].cardType).toBe(queue[2].cardType);
    expect(queue[1].cardType).toBe(queue[3].cardType);
  });
});
