"use client";

import { useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getAppUrl } from "@/lib/url";
import { useRouter } from "next/navigation";
import { validateSignupCode, claimSignupCode } from "@/app/actions/signup-code";

const EMAIL_REDIRECT_TO = `${getAppUrl()}/auth/callback`;

const RESEND_INFO_MESSAGE =
  "If an account exists for this email, we'll send a new confirmation email. Please check your inbox and spam folder.";

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

  const [resendEmail, setResendEmail] = useState("");
  const [resendSubmitting, setResendSubmitting] = useState(false);
  const [resendMessage, setResendMessage] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);

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
        console.warn(`[LoginForm] signIn failed: ${error.message}`);
        setMessage({
          type: "error",
          text: "Sign-in failed. Please check your email and password. If you still cannot get in, email du22662@bristol.ac.uk.",
        });
        return;
      }
      setMessage({ type: "ok", text: "Signed in. Redirecting…" });
      router.replace("/");
    } catch (error) {
      console.warn(`[LoginForm] signIn threw: ${getErrorMessage(error)}`);
      setMessage({
        type: "error",
        text: "Sign-in failed. Please check your email and password. If you still cannot get in, email du22662@bristol.ac.uk.",
      });
    } finally {
      setSubmitting(null);
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setSubmitting("signUp");
    try {
      const validate = await validateSignupCode(signupCode, signUpEmail);

      if (validate.state === "invalid_or_used") {
        setMessage({
          type: "error",
          text: "That signup code isn't valid, or it has been used by a different email. Try signing in if you've already created an account. If you still cannot get in, email du22662@bristol.ac.uk.",
        });
        return;
      }

      if (validate.state === "already_confirmed_same_email") {
        setMessage({
          type: "ok",
          text: "This account is already confirmed. Please sign in above. If you still cannot get in, email du22662@bristol.ac.uk.",
        });
        return;
      }

      if (validate.state === "pending_same_email") {
        setConfirmationPending(true);
        setMessage({
          type: "ok",
          text: "Your account was already created but still needs email confirmation. Please check your inbox and spam folder, or use the resend option below. If you still cannot get in, email du22662@bristol.ac.uk.",
        });
        return;
      }

      // state === "unused" — proceed with signUp
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.auth.signUp({
        email: signUpEmail,
        password: signUpPassword,
        options: {
          emailRedirectTo: EMAIL_REDIRECT_TO,
        },
      });
      if (error) {
        console.warn(`[LoginForm] signUp failed: ${error.message}`);
        setMessage({
          type: "error",
          text: "We couldn't create your account. Please check your details and try again. If you still cannot get in, email du22662@bristol.ac.uk.",
        });
        return;
      }
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        setMessage({
          type: "error",
          text: "An account with this email already exists. Try signing in, or use the resend option below if you never confirmed it. If you still cannot get in, email du22662@bristol.ac.uk.",
        });
        return;
      }
      if (data.user) {
        const claimResult = await claimSignupCode(
          signupCode,
          data.user.id,
          signUpEmail,
        );
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
      console.warn(`[LoginForm] signUp threw: ${getErrorMessage(error)}`);
      setMessage({
        type: "error",
        text: "Something went wrong. Please try again. If you still cannot get in, email du22662@bristol.ac.uk.",
      });
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
        console.warn(`[LoginForm] resend (post-signup) failed: ${error.message}`);
      }
      setMessage({ type: "ok", text: RESEND_INFO_MESSAGE });
    } catch (error) {
      console.warn(`[LoginForm] resend (post-signup) threw: ${getErrorMessage(error)}`);
      setMessage({ type: "ok", text: RESEND_INFO_MESSAGE });
    } finally {
      setTimeout(() => setResendCooldown(false), 30_000);
    }
  }

  async function handleStandaloneResend(e: React.FormEvent) {
    e.preventDefault();
    if (resendCooldown || !resendEmail) return;
    setResendCooldown(true);
    setResendSubmitting(true);
    setResendMessage(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: resendEmail,
        options: {
          emailRedirectTo: EMAIL_REDIRECT_TO,
        },
      });
      if (error) {
        console.warn(`[LoginForm] resend (standalone) failed: ${error.message}`);
      }
      setResendMessage({ type: "ok", text: RESEND_INFO_MESSAGE });
    } catch (error) {
      console.warn(`[LoginForm] resend (standalone) threw: ${getErrorMessage(error)}`);
      setResendMessage({ type: "ok", text: RESEND_INFO_MESSAGE });
    } finally {
      setResendSubmitting(false);
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

      <form
        onSubmit={handleStandaloneResend}
        className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800"
      >
        <h2 className="text-lg font-semibold">Didn&apos;t get the confirmation email?</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Enter the email you used to sign up and we&apos;ll resend the confirmation link.
        </p>
        <input
          type="email"
          placeholder="Email"
          value={resendEmail}
          onChange={(e) => setResendEmail(e.target.value)}
          required
          autoComplete="email"
          className="app-input"
          suppressHydrationWarning
        />
        <button
          type="submit"
          disabled={resendSubmitting || resendCooldown || !resendEmail}
          className="app-button-secondary"
        >
          {resendCooldown
            ? "Resend available in 30s"
            : resendSubmitting
              ? "…"
              : "Resend confirmation email"}
        </button>
        {resendMessage && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {resendMessage.text}
          </p>
        )}
      </form>
    </div>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
