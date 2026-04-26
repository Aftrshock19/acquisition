"use client";

import { useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getAppUrl } from "@/lib/url";
import { useRouter } from "next/navigation";
import { validateSignupCode, claimSignupCode } from "@/app/actions/signup-code";

const EMAIL_REDIRECT_TO = `${getAppUrl()}/auth/callback`;

export function LoginForm() {
  const router = useRouter();
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signupCode, setSignupCode] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);
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
      const codeResult = await validateSignupCode(signupCode);
      if (!codeResult.ok) {
        setMessage({ type: "error", text: "Invalid or already used signup code." });
        return;
      }
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
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        setMessage({ type: "error", text: "An account with this email already exists." });
        return;
      }
      if (data.user) {
        const claimResult = await claimSignupCode(signupCode, data.user.id);
        if (!claimResult.ok) {
          console.warn("Signup code claim failed:", claimResult.error);
        }
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
          suppressHydrationWarning
        />
        <div className="relative">
          <input
            type={showLoginPassword ? "text" : "password"}
            placeholder="Password"
            value={signInPassword}
            onChange={(e) => setSignInPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="app-input"
            suppressHydrationWarning
          />
          <button
            type="button"
            onClick={() => setShowLoginPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer border-0 bg-transparent text-sm text-neutral-400 hover:text-neutral-200"
          >
            {showLoginPassword ? "Hide" : "Show"}
          </button>
        </div>
        <button
          type="submit"
          disabled={submitting !== null}
          className="app-button"
        >
          {submitting === "signIn" ? "…" : "Sign in"}
        </button>
        <Link
          href="/auth/forgot-password"
          className="text-sm text-zinc-500 underline dark:text-zinc-400"
        >
          Forgot password?
        </Link>
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
          suppressHydrationWarning
        />
        <div className="relative">
          <input
            type={showSignUpPassword ? "text" : "password"}
            placeholder="Password (min 6 characters)"
            value={signUpPassword}
            onChange={(e) => setSignUpPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
            className="app-input"
            suppressHydrationWarning
          />
          <button
            type="button"
            onClick={() => setShowSignUpPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer border-0 bg-transparent text-sm text-neutral-400 hover:text-neutral-200"
          >
            {showSignUpPassword ? "Hide" : "Show"}
          </button>
        </div>
        <label htmlFor="signup-code" className="sr-only">
          Signup code
        </label>
        <input
          id="signup-code"
          type="text"
          placeholder="Enter your signup code"
          value={signupCode}
          onChange={(e) => setSignupCode(e.target.value)}
          required
          autoComplete="off"
          spellCheck={false}
          className="app-input"
          suppressHydrationWarning
        />
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          If you forgot your signup code please email{" "}
          <a href="mailto:du22662@bristol.ac.uk" className="underline">
            du22662@bristol.ac.uk
          </a>
        </p>
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
