import Link from "next/link";

export type StartedItem = {
  id: string;
  title: string;
  href: string;
  meta: string;
};

type Props = {
  kind: "reading" | "listening";
  items: StartedItem[];
};

export function StartedList({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
        Started
      </h2>
      <div className="flex flex-col gap-1.5">
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm transition hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
          >
            <span className="truncate text-zinc-900 dark:text-zinc-100">
              {item.title}
            </span>
            <span className="ml-2 shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
              {item.meta}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
