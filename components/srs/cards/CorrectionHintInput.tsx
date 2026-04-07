"use client";

import type { RefObject } from "react";
import { getFlashcardFieldToneClasses } from "@/components/srs/cards/FlashcardContainer";

type CorrectionHintInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  correctionHint?: string;
  correctionHintVisible?: boolean;
  tone: "default" | "success" | "error";
  inputRef?: RefObject<HTMLInputElement | null>;
  readOnly?: boolean;
  disabled?: boolean;
  wrapperClassName?: string;
  autoComplete?: string;
};

export function CorrectionHintInput({
  value,
  onChange,
  placeholder,
  correctionHint,
  correctionHintVisible = false,
  tone,
  inputRef,
  readOnly = false,
  disabled = false,
  wrapperClassName,
  autoComplete = "off",
}: CorrectionHintInputProps) {
  return (
    <div className={wrapperClassName}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={tone === "error" ? undefined : placeholder}
          aria-invalid={tone === "error"}
          autoComplete={autoComplete}
          readOnly={readOnly}
          disabled={disabled}
          className={`w-full rounded-lg px-3 py-2 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 disabled:opacity-50 dark:text-zinc-100 ${
            getFlashcardFieldToneClasses(tone)
          }`}
        />
        {tone === "error" && correctionHint ? (
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute inset-y-0 left-0 flex items-center px-3 text-sm text-zinc-400 transition-opacity duration-300 dark:text-zinc-500 ${
              correctionHintVisible && !value ? "opacity-100" : "opacity-0"
            }`}
          >
            {correctionHint}
          </span>
        ) : null}
      </div>
    </div>
  );
}
