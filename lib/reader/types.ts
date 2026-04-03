export type ReaderText = {
  id: string;
  lang: string;
  title: string;
  content: string;
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
    }
  | {
      ok: false;
      error: string;
    };
