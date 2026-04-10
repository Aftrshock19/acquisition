export default function ReadingLoading() {
  return (
    <main className="app-shell">
      <section className="app-hero">
        <div className="h-10 w-40 animate-pulse rounded-2xl bg-zinc-200/80 dark:bg-zinc-800/80" />
        <div className="h-5 w-full max-w-xl animate-pulse rounded-xl bg-zinc-200/70 dark:bg-zinc-800/70" />
      </section>

      <section className="app-card-strong flex flex-col gap-4 p-5 sm:p-6">
        <div className="h-4 w-24 animate-pulse rounded-full bg-zinc-200/70 dark:bg-zinc-800/70" />
        <div className="h-7 w-56 animate-pulse rounded-2xl bg-zinc-200/80 dark:bg-zinc-800/80" />
        <div className="h-5 w-full animate-pulse rounded-xl bg-zinc-200/70 dark:bg-zinc-800/70" />

        <div className="flex flex-col gap-3 pt-2">
          <div className="app-card h-28 animate-pulse p-4" />
          <div className="app-card h-28 animate-pulse p-4" />
          <div className="app-card h-28 animate-pulse p-4" />
        </div>
      </section>
    </main>
  );
}
