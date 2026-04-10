"use client";

import { tokenize } from "@/lib/reader/tokenize";
import type { ReaderToken } from "@/lib/reader/types";
import { useInteractiveTextContext } from "@/components/interactive-text/InteractiveTextProvider";

type InteractiveTextProps = {
  text?: string;
  tokens?: ReaderToken[];
  tokenKeyPrefix?: string;
  preserveFocusOnPress?: boolean;
  disabled?: boolean;
};

export function InteractiveText({
  text,
  tokens,
  tokenKeyPrefix,
  preserveFocusOnPress = false,
  disabled = false,
}: InteractiveTextProps) {
  const context = useInteractiveTextContext();
  const resolvedTokens = tokens ?? tokenize(text ?? "");
  const resolvedTokenKeyPrefix =
    tokenKeyPrefix ?? `interactive-text-${context?.interactionContext ?? "default"}`;

  return (
    <>
      {resolvedTokens.map((token, index) => {
        const key = `${resolvedTokenKeyPrefix}-${index}-${token.surface}`;
        const interactiveContext =
          context && !disabled && token.isWord ? context : null;

        if (!interactiveContext) {
          return <span key={key}>{token.surface}</span>;
        }

        const saved = interactiveContext.isTokenSaved(token);

        return (
          <button
            key={key}
            type="button"
            onClick={() => interactiveContext.openToken(token)}
            onMouseDown={
              preserveFocusOnPress
                ? (event) => {
                    event.preventDefault();
                  }
                : undefined
            }
            className={getInteractiveTextTokenButtonClassName(saved)}
          >
            {token.surface}
          </button>
        );
      })}
    </>
  );
}

export function getInteractiveTextTokenButtonClassName(saved: boolean) {
  return [
    "inline rounded-md px-0.5 py-0.5 text-left outline-none",
    "focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
    saved
      ? "bg-emerald-100/90 text-emerald-900 hover:bg-emerald-200/90 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
      : "text-inherit hover:bg-zinc-200/70 dark:hover:bg-zinc-800/80",
  ].join(" ");
}
