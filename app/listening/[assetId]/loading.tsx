export default function ListeningDetailLoading() {
  return (
    <main className="app-shell">
      <section className="app-hero">
        <div className="h-10 w-2/3 animate-pulse rounded-2xl bg-zinc-200/80 dark:bg-zinc-800/80" />
        <div className="h-5 w-full max-w-xl animate-pulse rounded-xl bg-zinc-200/70 dark:bg-zinc-800/70" />
      </section>

      <section className="app-card-strong flex flex-col gap-4 p-5 sm:p-6">
        <div className="h-10 w-28 animate-pulse rounded-xl bg-zinc-200/80 dark:bg-zinc-800/80" />
        <div className="h-3 w-full animate-pulse rounded-full bg-zinc-200/70 dark:bg-zinc-800/70" />
        <div className="h-2 w-full animate-pulse rounded-full bg-zinc-200/60 dark:bg-zinc-800/60" />
        <div className="flex gap-2">
          <div className="h-10 w-16 animate-pulse rounded-xl bg-zinc-200/70 dark:bg-zinc-800/70" />
          <div className="h-10 w-16 animate-pulse rounded-xl bg-zinc-200/70 dark:bg-zinc-800/70" />
          <div className="h-10 w-16 animate-pulse rounded-xl bg-zinc-200/70 dark:bg-zinc-800/70" />
        </div>
      </section>
    </main>
  );
}
