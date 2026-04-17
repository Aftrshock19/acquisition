"use client";

import { useState } from "react";
import { requestPasswordReset } from "./actions";

export function ForgotPasswordForm() {
  const [message, setMessage] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);
    setSubmitting(true);
    try {
      const formData = new FormData(e.currentTarget);
      const result = await requestPasswordReset(formData);
      if (result.error) {
        setMessage({ type: "error", text: result.error });
      } else if (result.success) {
        setMessage({ type: "ok", text: result.success });
      }
    } catch {
      setMessage({
        type: "error",
        text: "Something went wrong. Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <input
        type="email"
        name="email"
        placeholder="Email"
        required
        autoComplete="email"
        className="app-input"
      />
      <button type="submit" disabled={submitting} className="app-button">
        {submitting ? "…" : "Send reset link"}
      </button>
      {message && (
        <p
          className={
            message.type === "error"
              ? "text-red-600 dark:text-red-400"
              : "text-zinc-600 dark:text-zinc-400"
          }
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
