"use client";

import { useState } from "react";
import { resetPassword } from "./actions";

export function ResetPasswordForm({
  tokenHash,
  type,
}: {
  tokenHash: string;
  type: string;
}) {
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
      const result = await resetPassword(formData);
      // If resetPassword succeeds it redirects, so we only reach here on error
      if (result?.error) {
        setMessage({ type: "error", text: result.error });
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
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      <input
        type="password"
        name="password"
        placeholder="New password (min 6 characters)"
        required
        minLength={6}
        autoComplete="new-password"
        className="app-input"
      />
      <input
        type="password"
        name="confirmPassword"
        placeholder="Confirm new password"
        required
        minLength={6}
        autoComplete="new-password"
        className="app-input"
      />
      <button type="submit" disabled={submitting} className="app-button">
        {submitting ? "…" : "Set new password"}
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
