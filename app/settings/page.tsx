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
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-16">
        <BackButton />
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Supabase is not configured. Set environment variables and redeploy.
        </p>
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
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-16">
      <BackButton />
      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
      <FlashcardSettingsForm
        userSettings={settings}
        recommended={recommended}
        effective={effective}
      />
    </main>
  );
}
