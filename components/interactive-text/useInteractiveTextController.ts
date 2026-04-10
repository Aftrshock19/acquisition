"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { lookupReaderWordAction, saveReaderWordAction } from "@/app/reader/actions";
import { recordExposure } from "@/app/actions/srs";
import type { ReaderLookupEntry, ReaderToken } from "@/lib/reader/types";

export type SelectedWordToken = {
  surface: string;
  normalized: string;
};

export type InteractiveTextLookupState =
  | {
      status: "idle" | "loading" | "missing";
      entry: null;
      error: null;
    }
  | {
      status: "success";
      entry: ReaderLookupEntry;
      error: null;
    }
  | {
      status: "error";
      entry: null;
      error: string;
    };

const INITIAL_LOOKUP_STATE: InteractiveTextLookupState = {
  status: "idle",
  entry: null,
  error: null,
};

type UseInteractiveTextControllerOptions = {
  lang: string;
  initialSavedWordIds: string[];
  initialSavedLemmas: string[];
  textId?: string | null;
  saveSource?: "reader" | "flashcard";
  trackReaderTapExposure?: boolean;
  onWordTapped?: (wordId: string) => void;
  onWordSaved?: (wordId: string) => void;
};

export function useInteractiveTextController({
  lang,
  initialSavedWordIds,
  initialSavedLemmas,
  textId,
  saveSource = "reader",
  trackReaderTapExposure = false,
  onWordTapped,
  onWordSaved,
}: UseInteractiveTextControllerOptions) {
  const [selectedToken, setSelectedToken] = useState<SelectedWordToken | null>(null);
  const [lookupState, setLookupState] = useState<InteractiveTextLookupState>(
    INITIAL_LOOKUP_STATE,
  );
  const [savedWordIds, setSavedWordIds] = useState(
    () => new Set(initialSavedWordIds),
  );
  const [savedNormalized, setSavedNormalized] = useState(
    () => new Set(initialSavedLemmas.map((lemma) => lemma.toLocaleLowerCase("es"))),
  );
  const [resolvedWordIds, setResolvedWordIds] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [, startLookupTransition] = useTransition();
  const [savePending, startSaveTransition] = useTransition();
  const lookupRequestRef = useRef(0);

  const openToken = useCallback((token: ReaderToken) => {
    if (!token.isWord) {
      return;
    }

    const nextRequestId = lookupRequestRef.current + 1;
    lookupRequestRef.current = nextRequestId;

    setSelectedToken({
      surface: token.surface,
      normalized: token.normalized,
    });
    setLookupState({
      status: "loading",
      entry: null,
      error: null,
    });
    setSaveError(null);

    startLookupTransition(() => {
      void lookupReaderWordAction({
        lang,
        normalized: token.normalized,
      }).then((result) => {
        if (lookupRequestRef.current !== nextRequestId) {
          return;
        }

        if (!result.ok) {
          setLookupState({
            status: "error",
            entry: null,
            error: result.error,
          });
          return;
        }

        if (!result.entry) {
          setLookupState({
            status: "missing",
            entry: null,
            error: null,
          });
          return;
        }

        const entry = result.entry;

        setResolvedWordIds((current) => ({
          ...current,
          [token.normalized]: entry.id,
        }));
        onWordTapped?.(entry.id);
        if (trackReaderTapExposure) {
          void recordExposure({
            wordId: entry.id,
            kind: "reader_tap",
          });
        }
        setLookupState({
          status: "success",
          entry,
          error: null,
        });
      });
    });
  }, [lang, onWordTapped, startLookupTransition, trackReaderTapExposure]);

  const closePanel = useCallback(() => {
    lookupRequestRef.current += 1;
    setSelectedToken(null);
    setLookupState(INITIAL_LOOKUP_STATE);
    setSaveError(null);
  }, []);

  const saveSelectedWord = useCallback(() => {
    if (!selectedToken || lookupState.status !== "success") {
      return;
    }

    const entry = lookupState.entry;
    const previousSavedWordIds = new Set(savedWordIds);
    const previousSavedNormalized = new Set(savedNormalized);

    setSaveError(null);
    setSavedWordIds((current) => new Set(current).add(entry.id));
    setSavedNormalized((current) => {
      const next = new Set(current);
      next.add(selectedToken.normalized);
      next.add(entry.lemma.toLocaleLowerCase("es"));
      return next;
    });
    setResolvedWordIds((current) => ({
      ...current,
      [selectedToken.normalized]: entry.id,
    }));

    startSaveTransition(() => {
      void saveReaderWordAction({
        lang,
        wordId: entry.id,
        textId,
        saveSource,
      }).then((result) => {
        if (result.ok) {
          onWordSaved?.(entry.id);
          return;
        }

        setSavedWordIds(previousSavedWordIds);
        setSavedNormalized(previousSavedNormalized);
        setSaveError(result.error);
      });
    });
  }, [
    lang,
    lookupState,
    savedNormalized,
    savedWordIds,
    saveSource,
    selectedToken,
    textId,
    onWordSaved,
    startSaveTransition,
  ]);

  const isTokenSaved = useCallback((token: ReaderToken) => {
    if (savedNormalized.has(token.normalized)) {
      return true;
    }

    const resolvedWordId = resolvedWordIds[token.normalized];
    return resolvedWordId ? savedWordIds.has(resolvedWordId) : false;
  }, [resolvedWordIds, savedNormalized, savedWordIds]);

  const currentEntrySaved =
    lookupState.status === "success"
      ? savedWordIds.has(lookupState.entry.id)
      : false;

  return {
    currentEntrySaved,
    lookupState,
    saveError,
    savePending,
    selectedToken,
    closePanel,
    isTokenSaved,
    openToken,
    saveSelectedWord,
  };
}
