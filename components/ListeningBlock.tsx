export function ListeningBlock({
  title,
  audioUrl,
}: {
  title: string;
  audioUrl?: string;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {audioUrl ? (
        <audio controls src={audioUrl} />
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          No audio configured.
        </p>
      )}
    </section>
  );
}
