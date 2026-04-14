"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getAppUrl } from "@/lib/url";
import { useRouter } from "next/navigation";

const EMAIL_REDIRECT_TO = `${getAppUrl()}/auth/callback`;

export function LoginForm() {
  const router = useRouter();
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState<"signIn" | "signUp" | null>(null);
  const [confirmationPending, setConfirmationPending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(false);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setSubmitting("signIn");
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: signInEmail,
        password: signInPassword,
      });
      if (error) {
        setMessage({ type: "error", text: error.message });
        return;
      }
      setMessage({ type: "ok", text: "Signed in. Redirecting…" });
      router.replace("/");
    } catch (error) {
      setMessage({ type: "error", text: getErrorMessage(error) });
    } finally {
      setSubmitting(null);
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setSubmitting("signUp");
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.auth.signUp({
        email: signUpEmail,
        password: signUpPassword,
        options: {
          emailRedirectTo: EMAIL_REDIRECT_TO,
        },
      });
      if (error) {
        setMessage({ type: "error", text: error.message });
        return;
      }
      if (data.session) {
        setMessage({ type: "ok", text: "Account created. Redirecting…" });
        router.replace("/");
        return;
      }
      setConfirmationPending(true);
      setMessage({
        type: "ok",
        text: "We sent a confirmation link to your email. Please check your inbox (and spam folder) to complete sign-up.",
      });
      router.refresh();
    } catch (error) {
      setMessage({ type: "error", text: getErrorMessage(error) });
    } finally {
      setSubmitting(null);
    }
  }

  async function handleResend() {
    if (resendCooldown || !signUpEmail) return;
    setResendCooldown(true);
    setMessage(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: signUpEmail,
        options: {
          emailRedirectTo: EMAIL_REDIRECT_TO,
        },
      });
      if (error) {
        setMessage({ type: "error", text: error.message });
      } else {
        setMessage({ type: "ok", text: "Confirmation email resent. Please check your inbox." });
      }
    } catch (error) {
      setMessage({ type: "error", text: getErrorMessage(error) });
    } finally {
      setTimeout(() => setResendCooldown(false), 30_000);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSignIn} className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Sign in</h2>
        <input
          type="email"
          placeholder="Email"
          value={signInEmail}
          onChange={(e) => setSignInEmail(e.target.value)}
          required
          autoComplete="email"
          className="app-input"
        />
        <input
          type="password"
          placeholder="Password"
          value={signInPassword}
          onChange={(e) => setSignInPassword(e.target.value)}
          required
          autoComplete="current-password"
          className="app-input"
        />
        <button
          type="submit"
          disabled={submitting !== null}
          className="app-button"
        >
          {submitting === "signIn" ? "…" : "Sign in"}
        </button>
      </form>

      <form onSubmit={handleSignUp} className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Create account</h2>
        <input
          type="email"
          placeholder="Email"
          value={signUpEmail}
          onChange={(e) => setSignUpEmail(e.target.value)}
          required
          autoComplete="email"
          className="app-input"
        />
        <input
          type="password"
          placeholder="Password (min 6 characters)"
          value={signUpPassword}
          onChange={(e) => setSignUpPassword(e.target.value)}
          required
          minLength={6}
          autoComplete="new-password"
          className="app-input"
        />
        <button
          type="submit"
          disabled={submitting !== null}
          className="app-button-secondary"
        >
          {submitting === "signUp" ? "…" : "Sign up"}
        </button>
      </form>

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

      {confirmationPending && (
        <button
          type="button"
          onClick={handleResend}
          disabled={resendCooldown}
          className="app-button-secondary text-sm"
        >
          {resendCooldown ? "Resend available in 30s" : "Resend confirmation email"}
        </button>
      )}
    </div>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
