import { redirect } from 'next/navigation';
import { BackButton } from '@/components/BackButton';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getUserSettings } from '@/lib/settings/getUserSettings';
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { settings } = await getUserSettings();
  const recommended = await recommendSettings();
  const effective = resolveEffectiveSettings(settings, recommended);

  return (
    <main className="app-shell">
      <BackButton />
      <section className="app-hero">
        <h1 className="app-title">Settings</h1>
        <p className="app-subtitle">
          Tune daily load, card mix, and retry behavior.
        </p>
      </section>
      <div className="app-card-strong p-8">
        <FlashcardSettingsForm
          userSettings={settings}
          recommended={recommended}
          effective={effective}
        />
      </div>
    </main>
  );
}
