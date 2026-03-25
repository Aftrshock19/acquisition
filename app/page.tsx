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
    <main className="app-shell">
      <section className="app-hero">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
          Daily language system
        </p>
        <h1 className="app-title">Acquisition</h1>
        <p className="app-subtitle">Your daily Spanish practice.</p>
      </section>
      <div className="flex flex-col gap-3">
        <Link href="/today" className="app-link-card font-medium">
          Today — reviews & new words
        </Link>
        <Link href="/progress" className="app-link-card font-medium">
          Progress
        </Link>
        <Link href="/settings" className="app-link-card font-medium">
          Settings
        </Link>
      </div>
      {signedIn && (
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
