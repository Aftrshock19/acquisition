import { redirect } from 'next/navigation';
import { BackButton } from '@/components/BackButton';
import { getSupabaseUser } from '@/lib/supabase/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getUserSettings } from '@/lib/settings/getUserSettings';
import { getMcqQuestionFormatsPreference } from '@/lib/settings/mcqQuestionFormats';
import { recommendSettings } from '@/lib/settings/recommendSettings';
import { resolveEffectiveSettings } from '@/lib/settings/resolveEffectiveSettings';
import { FlashcardSettingsForm } from '@/components/settings/FlashcardSettingsForm';

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return (
      <main className="app-shell">
        <BackButton />
        <section className="app-hero">
          <h1 className="app-title">Settings</h1>
          <p className="app-subtitle">
            Supabase is not configured. Set environment variables and redeploy.
          </p>
        </section>
      </main>
    );
  }

  const { user, error } = await getSupabaseUser(supabase);

  if (error) {
    return (
      <main className="app-shell">
        <BackButton />
        <section className="app-hero">
          <h1 className="app-title">Settings</h1>
          <p className="app-subtitle">
            Tune daily load, card families, advanced directions, and retry behavior.
          </p>
        </section>
        <section className="app-card-strong flex flex-col gap-3 border-red-200 bg-red-50/90 p-8 dark:border-red-900/50 dark:bg-red-950/30">
          <h2 className="text-xl font-semibold tracking-tight text-red-900 dark:text-red-100">
            Authentication unavailable
          </h2>
          <p className="text-sm leading-6 text-red-800 dark:text-red-200">
            {error}
          </p>
        </section>
      </main>
    );
  }

  if (!user) {
    redirect('/login');
  }

  const { settings } = await getUserSettings();
  const mcqQuestionFormats = await getMcqQuestionFormatsPreference();
  const recommended = await recommendSettings();
  const effective = resolveEffectiveSettings(settings, recommended);

  return (
    <main className="app-shell">
      <BackButton />
      <section className="app-hero">
        <h1 className="app-title">Settings</h1>
        <p className="app-subtitle">
          Tune daily load, card families, advanced directions, and retry behavior.
        </p>
      </section>
      <div className="app-card-strong p-8">
        <FlashcardSettingsForm
          userSettings={settings}
          mcqQuestionFormats={mcqQuestionFormats}
          recommended={recommended}
          effective={effective}
        />
      </div>
    </main>
  );
}
