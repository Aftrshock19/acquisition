"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMessage({ type: "error", text: error.message });
        return;
      }
      setMessage({ type: "ok", text: "Signed in. Redirecting…" });
      router.refresh();
      router.push("/today");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setMessage({ type: "error", text: error.message });
        return;
      }
      setMessage({ type: "ok", text: "Check your email to confirm, or sign in if you already have an account." });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSignIn} className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Sign in</h2>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="app-input"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="app-input"
        />
        <button
          type="submit"
          disabled={loading}
          className="app-button"
        >
          {loading ? "…" : "Sign in"}
        </button>
      </form>

      <form onSubmit={handleSignUp} className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Create account</h2>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="app-input"
        />
        <input
          type="password"
          placeholder="Password (min 6 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          className="app-input"
        />
        <button
          type="submit"
          disabled={loading}
          className="app-button-secondary"
        >
          {loading ? "…" : "Sign up"}
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
    </div>
  );
}
