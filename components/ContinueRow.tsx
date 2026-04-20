import Link from "next/link";

type Props = {
  title: string;
  href: string;
  meta: string;
};

export function ContinueRow({ title, href, meta }: Props) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
        Continue where you left off
      </h2>
      <Link
        href={href}
        className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm transition hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
      >
        <span className="truncate text-zinc-900 dark:text-zinc-100">{title}</span>
        <span className="ml-2 shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
          {meta}
        </span>
      </Link>
    </section>
  );
}
