import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions/auth";
import { BackButton } from "@/components/BackButton";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserSettings } from "@/lib/settings/getUserSettings";
import { recommendSettings } from "@/lib/settings/recommendSettings";
import { resolveEffectiveSettings } from "@/lib/settings/resolveEffectiveSettings";

export default async function ProfilePage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return (
      <main className="app-shell">
        <BackButton />
        <section className="app-hero">
          <h1 className="app-title">Profile</h1>
          <p className="app-subtitle">
            Supabase is not configured. Set environment variables and redeploy.
          </p>
        </section>
      </main>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { settings, exists } = await getUserSettings();
  const recommended = await recommendSettings();
  const effective = resolveEffectiveSettings(settings, recommended);
  const enabledTypeCount = Object.values(effective.enabledModes).filter(Boolean).length;

  return (
    <main className="app-shell">
      <BackButton />
      <section className="app-hero">
        <h1 className="app-title">Profile</h1>
        <p className="app-subtitle">
          Your signed-in account, current study setup, and session controls.
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <section className="app-card-strong flex flex-col gap-6 p-8">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
              Account
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              {user.email ?? "Email unavailable"}
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Supabase user ID: <span className="font-mono">{shortenUserId(user.id)}</span>
            </p>
          </div>

          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="app-card-muted p-4">
              <dt className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                Email
              </dt>
              <dd className="mt-2 break-all text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {user.email ?? "Unavailable"}
              </dd>
            </div>
            <div className="app-card-muted p-4">
              <dt className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                User ID
              </dt>
              <dd className="mt-2 font-mono text-sm text-zinc-900 dark:text-zinc-100">
                {shortenUserId(user.id)}
              </dd>
            </div>
          </dl>

          <form action={signOutAction}>
            <button type="submit" className="app-button-secondary">
              Sign out
            </button>
          </form>
        </section>

        <section className="app-card flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Settings summary</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {exists ? "Using your saved settings." : "Using defaults and recommendations."}
            </p>
          </div>

          <dl className="grid gap-3">
            <div className="flex items-center justify-between rounded-xl border border-zinc-200/80 px-4 py-3 dark:border-zinc-800">
              <dt className="text-sm text-zinc-600 dark:text-zinc-400">Daily limit</dt>
              <dd className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {effective.effectiveDailyLimit}
              </dd>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-zinc-200/80 px-4 py-3 dark:border-zinc-800">
              <dt className="text-sm text-zinc-600 dark:text-zinc-400">Enabled types</dt>
              <dd className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {enabledTypeCount}
              </dd>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-zinc-200/80 px-4 py-3 dark:border-zinc-800">
              <dt className="text-sm text-zinc-600 dark:text-zinc-400">POS hints</dt>
              <dd className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {effective.showPosHint ? "On" : "Off"}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <Link href="/today" className="app-link-card font-medium">
          Today
        </Link>
        <Link href="/settings" className="app-link-card font-medium">
          Settings
        </Link>
        <Link href="/progress" className="app-link-card font-medium">
          Progress
        </Link>
      </section>
    </main>
  );
}

function shortenUserId(id: string | null | undefined) {
  if (!id) return "Unavailable";
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}
