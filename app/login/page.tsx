import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { getSupabaseUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; confirmed?: string }>;
}) {
  const { error: callbackError, confirmed } = await searchParams;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <main className="app-shell">
        <section className="app-hero">
          <h1 className="app-title">Login</h1>
          <p className="app-subtitle">
            Sign in or create an account to use daily reviews and new words.
          </p>
        </section>
        <div className="app-card-strong flex flex-col gap-4 border-amber-200 bg-amber-50/90 p-8 dark:border-amber-900/50 dark:bg-amber-950/30">
          <h2 className="text-xl font-semibold tracking-tight text-amber-900 dark:text-amber-100">
            Supabase not configured
          </h2>
          <p className="text-amber-800 dark:text-amber-200">
            Copy <code className="rounded bg-amber-200 px-1 dark:bg-amber-900/50">.env.example</code> to{" "}
            <code className="rounded bg-amber-200 px-1 dark:bg-amber-900/50">.env.local</code> and set{" "}
            <code className="rounded bg-amber-200 px-1 dark:bg-amber-900/50">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code className="rounded bg-amber-200 px-1 dark:bg-amber-900/50">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
          </p>
        </div>
        <p className="text-sm text-zinc-500">
          <Link href="/" className="underline">Back to home</Link>
        </p>
      </main>
    );
  }

  const { user, error } = await getSupabaseUser(supabase);

  if (error) {
    return (
      <main className="app-shell">
        <section className="app-hero">
          <h1 className="app-title">Login</h1>
          <p className="app-subtitle">
            Sign in or create an account to use daily reviews and new words.
          </p>
        </section>
        <div className="app-card-strong flex flex-col gap-4 border-red-200 bg-red-50/90 p-8 dark:border-red-900/50 dark:bg-red-950/30">
          <h2 className="text-xl font-semibold tracking-tight text-red-900 dark:text-red-100">
            Authentication unavailable
          </h2>
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
        <p className="text-sm text-zinc-500">
          <Link href="/" className="underline">Back to home</Link>
        </p>
      </main>
    );
  }

  if (user) {
    redirect("/");
  }

  return (
    <main className="app-shell">
      <section className="app-hero">
        <h1 className="app-title">Login</h1>
        <p className="app-subtitle">
          Sign in or create an account to use daily reviews and new words.
        </p>
      </section>
      {confirmed === "true" && (
        <div className="app-card-strong flex flex-col gap-2 border-emerald-200 bg-emerald-50/90 p-6 dark:border-emerald-900/50 dark:bg-emerald-950/30">
          <p className="text-emerald-800 dark:text-emerald-200">
            Email confirmed. You can now sign in.
          </p>
        </div>
      )}
      {callbackError && (
        <div className="app-card-strong flex flex-col gap-2 border-red-200 bg-red-50/90 p-6 dark:border-red-900/50 dark:bg-red-950/30">
          <p className="text-red-800 dark:text-red-200">{callbackError}</p>
        </div>
      )}
      <div className="app-card p-6">
        <LoginForm />
      </div>
      <p className="text-sm text-zinc-500">
        <Link href="/" className="underline">Back to home</Link>
      </p>
    </main>
  );
}
