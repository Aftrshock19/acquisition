export type ReaderText = {
  id: string;
  lang: string;
  title: string;
  content: string;
  collectionId: string | null;
  orderIndex: number | null;
  sectionNumber: number | null;
  wordCount: number | null;
  estimatedMinutes: number | null;
  difficultyCefr: string | null;
  collection: {
    id: string;
    title: string;
    lang: string;
    author: string | null;
    description: string | null;
    collectionType: string | null;
  } | null;
};

export type ReaderToken = {
  surface: string;
  normalized: string;
  isWord: boolean;
};

export type ReaderLookupEntry = {
  id: string;
  lemma: string;
  definition: string | null;
  pos: string | null;
};

export type ReaderProgressState = {
  furthestBlockIndex: number;
  blocksTotal: number;
  wordsTapped: number;
  wordsSaved: number;
  timeSpentSeconds: number;
  completedAt: string | null;
  lastReadAt: string | null;
};

export type LookupReaderWordResult =
  | {
      ok: true;
      entry: ReaderLookupEntry | null;
    }
  | {
      ok: false;
      error: string;
    };

export type SaveReaderWordResult =
  | {
      ok: true;
      wordId: string;
      highlightForms: string[];
    }
  | {
      ok: false;
      error: string;
    };

export type PersistReaderProgressResult =
  | {
      ok: true;
      progress: ReaderProgressState;
    }
  | {
      ok: false;
      error: string;
    };

export type CompleteReaderResult =
  | {
      ok: true;
      progress: ReaderProgressState;
      readingDone: boolean;
    }
  | {
      ok: false;
      error: string;
    };
