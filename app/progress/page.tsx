import { BackButton } from "@/components/BackButton";

export default function ProgressPage() {
  return (
    <main className="app-shell">
      <BackButton />
      <section className="app-hero">
        <h1 className="app-title">Progress</h1>
        <p className="app-subtitle">
          Placeholder for streaks, stats, and recent activity.
        </p>
      </section>
    </main>
  );
}
