import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BackButton } from '@/components/BackButton';
import { getUserSettings } from '@/lib/settings/getUserSettings';
import { getMcqQuestionFormatsPreference } from '@/lib/settings/mcqQuestionFormats';
import { recommendSettings } from '@/lib/settings/recommendSettings';
import { resolveEffectiveSettings } from '@/lib/settings/resolveEffectiveSettings';
import { FlashcardSettingsForm } from '@/components/settings/FlashcardSettingsForm';
import { getSupabaseServerContextFast } from '@/lib/supabase/server';
import { getTodaySessionDate } from '@/lib/loop/dailySessions';

async function getTodaySessionSnapshot(): Promise<{
  completedCount: number;
  effectiveDailyTargetMode: 'recommended' | 'manual' | null;
  assignedFlashcardCount: number | null;
  recommendedTargetAtCreation: number | null;
}> {
  const { supabase, user } = await getSupabaseServerContextFast();
  if (!supabase || !user) {
    return {
      completedCount: 0,
      effectiveDailyTargetMode: null,
      assignedFlashcardCount: null,
      recommendedTargetAtCreation: null,
    };
  }
  // Freshness of this read across navigations relies on the router.refresh()
  // call in <TodaySession>'s unmount effect (components/srs/TodaySession.tsx)
  // to invalidate the RSC cache when the user leaves /today. Without that, a
  // /today → /settings soft nav could serve a stale snapshot from before the
  // session row was created.
  const { data } = await supabase
    .from('daily_sessions')
    .select(
      'flashcard_completed_count, effective_daily_target_mode, assigned_flashcard_count, recommended_target_at_creation',
    )
    .eq('user_id', user.id)
    .eq('session_date', getTodaySessionDate())
    .maybeSingle();
  const row = data as {
    flashcard_completed_count: number | null;
    effective_daily_target_mode: 'recommended' | 'manual' | null;
    assigned_flashcard_count: number | null;
    recommended_target_at_creation: number | null;
  } | null;
  return {
    completedCount: row?.flashcard_completed_count ?? 0,
    effectiveDailyTargetMode: row?.effective_daily_target_mode ?? null,
    assignedFlashcardCount: row?.assigned_flashcard_count ?? null,
    recommendedTargetAtCreation: row?.recommended_target_at_creation ?? null,
  };
}

export default async function SettingsPage() {
  const [
    { settings, signedIn, error },
    mcqQuestionFormats,
    recommended,
    todaySession,
  ] = await Promise.all([
    getUserSettings(),
    getMcqQuestionFormatsPreference(),
    recommendSettings(),
    getTodaySessionSnapshot(),
  ]);

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
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

  if (!signedIn) {
    redirect('/login');
  }

  // Stabilize the recommended daily limit for the day. Once today's session
  // row exists with a frozen recommended_target_at_creation snapshot, every
  // place on /settings that reasons about "the recommended number" must use
  // that snapshot — otherwise the label drifts mid-day as accuracy and
  // inactivity inputs change. Fall back to the live recommender value when
  // no usable snapshot is available: null (legacy rows pre-migration) or
  // <= 0 (defensive — recommender clamps to FLOOR > 0, so this is impossible
  // in practice but guards against future migrations or bad writes).
  const snapshotLimit = todaySession.recommendedTargetAtCreation;
  const stableRecommended =
    typeof snapshotLimit === 'number' && snapshotLimit > 0
      ? { ...recommended, recommendedDailyLimit: snapshotLimit }
      : recommended;
  const effective = resolveEffectiveSettings(settings, stableRecommended);

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
          recommended={stableRecommended}
          effective={effective}
          todayCompletedCount={todaySession.completedCount}
          effectiveDailyTargetMode={todaySession.effectiveDailyTargetMode}
          todayAssignedCount={todaySession.assignedFlashcardCount}
        />
      </div>
      <div className="app-card flex flex-col gap-2 p-6">
        <h2 className="text-base font-semibold tracking-tight">
          Placement check
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Retake the short diagnostic any time to reset your starting point.
        </p>
        <Link
          href="/placement"
          className="self-start text-sm font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
        >
          Retake placement
        </Link>
      </div>
    </main>
  );
}
