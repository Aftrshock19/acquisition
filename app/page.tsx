import Link from "next/link";
import { getUserSettings } from "@/lib/settings/getUserSettings";
import { recommendSettings } from "@/lib/settings/recommendSettings";
import { resolveEffectiveSettings } from "@/lib/settings/resolveEffectiveSettings";
import { FlashcardSettingsPanel } from "@/components/settings/FlashcardSettingsPanel";

export default async function HomePage() {
  const { settings, signedIn } = await getUserSettings();
  const recommended = await recommendSettings();
  const effective = resolveEffectiveSettings(settings, recommended);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Acquisition</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Your daily Spanish practice.
      </p>
      <div className="flex flex-col gap-3">
        <Link
          href="/today"
          className="rounded-lg border border-zinc-200 bg-white px-4 py-3 font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          Today — reviews & new words
        </Link>
        <Link
          href="/progress"
          className="rounded-lg border border-zinc-200 bg-white px-4 py-3 font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          Progress
        </Link>
        <Link
          href="/settings"
          className="rounded-lg border border-zinc-200 bg-white px-4 py-3 font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          Settings
        </Link>
      </div>
      {signedIn && (
        <FlashcardSettingsPanel
          variant="home"
          userSettings={settings}
          effective={effective}
        />
      )}
    </main>
  );
}
