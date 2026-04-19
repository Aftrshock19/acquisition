type Props = {
  kind: "reading" | "listening";
};

export function EmptyRecommendationCard({ kind: _kind }: Props) {
  return (
    <section className="app-card-muted flex flex-col gap-2 p-5 sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        All caught up
      </h2>
      <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        You&apos;ve worked through everything at your level. New material is added regularly — check back soon.
      </p>
    </section>
  );
}
