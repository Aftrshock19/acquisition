import Link from "next/link";

type BackButtonProps = {
  href?: string;
  label?: string;
  className?: string;
};

export function BackButton({
  href = "/",
  label = "Go home",
  className = "",
}: BackButtonProps) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={`flex h-10 w-10 items-center justify-center rounded-full border border-zinc-300 text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900 ${className}`.trim()}
    >
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
        <path
          d="M11.5 4.5L6 10l5.5 5.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
}
