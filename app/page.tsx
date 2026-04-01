import Link from "next/link";
import { getUserSettings } from "@/lib/settings/getUserSettings";
import { recommendSettings } from "@/lib/settings/recommendSettings";
import { resolveEffectiveSettings } from "@/lib/settings/resolveEffectiveSettings";
import { FlashcardSettingsPanel } from "@/components/settings/FlashcardSettingsPanel";

export default async function HomePage() {
  const { settings, signedIn } = await getUserSettings();
  const recommended = signedIn ? await recommendSettings() : null;
  const effective =
    signedIn && recommended
      ? resolveEffectiveSettings(settings, recommended)
      : null;

  return (
    <main className="app-shell">
      <section className="flex items-start justify-between gap-4">
        <div className="app-hero">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
            Daily language system
          </p>
          <h1 className="app-title">Acquisition</h1>
          <p className="app-subtitle">Your daily Spanish practice.</p>
        </div>
        {signedIn ? (
          <Link href="/profile" className="app-button-secondary shrink-0">
            Profile
          </Link>
        ) : null}
      </section>
      {signedIn ? (
        <div className="flex flex-col gap-3">
          <Link href="/today" className="app-link-card font-medium">
            Today
          </Link>
          <Link href="/progress" className="app-link-card font-medium">
            Progress
          </Link>
          <Link href="/Decks" className="app-link-card font-medium">
            Decks
          </Link>
          <Link href="/settings" className="app-link-card font-medium">
            Settings
          </Link>
        </div>
      ) : (
        <Link
          href="/login"
          className="flex min-h-32 items-center justify-center rounded-2xl bg-zinc-900 px-8 py-6 text-center text-xl font-semibold text-white shadow-lg shadow-zinc-900/15 transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Sign in
        </Link>
      )}
      {signedIn && effective && (
        <div className="app-card p-5">
          <FlashcardSettingsPanel
            variant="home"
            userSettings={settings}
            effective={effective}
          />
        </div>
      )}
    </main>
  );
}
