"use client";

import type { CSSProperties, RefObject } from "react";
import { getFlashcardFieldToneClasses } from "@/components/srs/cards/FlashcardContainer";

type TextAnswerInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  correctionHint?: string;
  correctionHintVisible?: boolean;
  tone: "default" | "success" | "error";
  inputRef?: RefObject<HTMLInputElement | null>;
  readOnly?: boolean;
  disabled?: boolean;
  autoComplete?: string;
  variant?: "block" | "inline";
  wrapperClassName?: string;
  inputClassName?: string;
  correctionHintClassName?: string;
  inputStyle?: CSSProperties;
};

export function TextAnswerInput({
  value,
  onChange,
  placeholder,
  correctionHint,
  correctionHintVisible = false,
  tone,
  inputRef,
  readOnly = false,
  disabled = false,
  autoComplete = "off",
  variant = "block",
  wrapperClassName,
  inputClassName,
  correctionHintClassName,
  inputStyle,
}: TextAnswerInputProps) {
  const Wrapper = variant === "inline" ? "span" : "div";
  const wrapperBaseClassName = variant === "inline" ? "relative" : "relative";
  const inputBaseClassName =
    variant === "inline"
      ? "rounded-md px-0 pb-1 align-baseline text-center text-xl font-medium tracking-tight text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 disabled:opacity-50 dark:text-zinc-100"
      : "w-full rounded-lg px-3 py-2 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 disabled:opacity-50 dark:text-zinc-100";
  const correctionHintBaseClassName =
    variant === "inline"
      ? "pointer-events-none absolute inset-0 flex items-center justify-center px-3 text-center text-xl font-medium tracking-tight text-zinc-400 transition-opacity duration-300 dark:text-zinc-500"
      : "pointer-events-none absolute inset-y-0 left-0 flex items-center px-3 text-sm text-zinc-400 transition-opacity duration-300 dark:text-zinc-500";

  return (
    <Wrapper
      className={
        wrapperClassName
          ? `${wrapperBaseClassName} ${wrapperClassName}`
          : wrapperBaseClassName
      }
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={tone === "error" ? undefined : placeholder}
        aria-invalid={tone === "error"}
        autoComplete={autoComplete}
        spellCheck={false}
        readOnly={readOnly}
        disabled={disabled}
        style={inputStyle}
        className={`${inputBaseClassName} ${getFlashcardFieldToneClasses(tone)}${
          inputClassName ? ` ${inputClassName}` : ""
        }`}
      />
      {tone === "error" && correctionHint ? (
        <span
          aria-hidden="true"
          className={`${correctionHintBaseClassName}${
            correctionHintClassName ? ` ${correctionHintClassName}` : ""
          } ${correctionHintVisible && !value ? "opacity-100" : "opacity-0"}`}
        >
          {correctionHint}
        </span>
      ) : null}
    </Wrapper>
  );
}
