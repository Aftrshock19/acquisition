"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { WordLookupPanel } from "@/components/interactive-text/WordLookupPanel";
import { useInteractiveTextController } from "@/components/interactive-text/useInteractiveTextController";
import type { ReaderToken } from "@/lib/reader/types";

type InteractiveTextContextValue = {
  interactionContext?: string;
  openToken: (token: ReaderToken) => void;
  isTokenSaved: (token: ReaderToken) => boolean;
};

const InteractiveTextContext = createContext<InteractiveTextContextValue | null>(null);

type InteractiveTextProviderProps = {
  children: ReactNode;
  lang: string;
  initialSavedWordIds: string[];
  initialSavedLemmas: string[];
  interactionContext?: string;
  closeSignal?: string | number | null;
  textId?: string | null;
  saveSource?: "reader" | "flashcard";
  trackReaderTapExposure?: boolean;
  onWordTapped?: (wordId: string) => void;
  onWordSaved?: (wordId: string) => void;
};

export function InteractiveTextProvider({
  children,
  lang,
  initialSavedWordIds,
  initialSavedLemmas,
  interactionContext,
  closeSignal,
  textId,
  saveSource,
  trackReaderTapExposure,
  onWordTapped,
  onWordSaved,
}: InteractiveTextProviderProps) {
  const controller = useInteractiveTextController({
    lang,
    initialSavedWordIds,
    initialSavedLemmas,
    textId,
    saveSource,
    trackReaderTapExposure,
    onWordTapped,
    onWordSaved,
  });
  const {
    closePanel,
    currentEntrySaved,
    isTokenSaved,
    lookupState,
    openToken,
    saveError,
    savePending,
    saveSelectedWord,
    selectedToken,
  } = controller;
  const previousCloseSignalRef = useRef(closeSignal);

  useEffect(() => {
    if (previousCloseSignalRef.current === closeSignal) {
      return;
    }

    previousCloseSignalRef.current = closeSignal;
    closePanel();
  }, [closePanel, closeSignal]);

  const contextValue = useMemo<InteractiveTextContextValue>(
    () => ({
      interactionContext,
      openToken,
      isTokenSaved,
    }),
    [interactionContext, isTokenSaved, openToken],
  );

  return (
    <InteractiveTextContext.Provider value={contextValue}>
      {children}
      <WordLookupPanel
        interactionContext={interactionContext}
        selectedToken={selectedToken}
        lookupState={lookupState}
        currentEntrySaved={currentEntrySaved}
        savePending={savePending}
        saveError={saveError}
        onClose={closePanel}
        onSave={saveSelectedWord}
      />
    </InteractiveTextContext.Provider>
  );
}

export function useInteractiveTextContext() {
  return useContext(InteractiveTextContext);
}
