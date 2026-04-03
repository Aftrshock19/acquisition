export default function ReaderLoading() {
  return (
    <main className="app-shell">
      <section className="app-hero">
        <div className="h-10 w-2/3 animate-pulse rounded-2xl bg-zinc-200/80 dark:bg-zinc-800/80" />
        <div className="h-5 w-1/2 animate-pulse rounded-xl bg-zinc-200/70 dark:bg-zinc-800/70" />
      </section>

      <section className="app-card flex flex-col gap-4 p-6">
        <div className="h-5 w-full animate-pulse rounded-xl bg-zinc-200/80 dark:bg-zinc-800/80" />
        <div className="h-5 w-11/12 animate-pulse rounded-xl bg-zinc-200/70 dark:bg-zinc-800/70" />
        <div className="h-5 w-10/12 animate-pulse rounded-xl bg-zinc-200/70 dark:bg-zinc-800/70" />
        <div className="h-5 w-full animate-pulse rounded-xl bg-zinc-200/60 dark:bg-zinc-800/60" />
      </section>
    </main>
  );
}
