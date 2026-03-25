import Link from "next/link";
import { Settings2 } from "lucide-react";

type SettingsButtonProps = {
  href?: string;
  label?: string;
  className?: string;
};

export function SettingsButton({
  href = "/settings",
  label = "Open settings",
  className = "",
}: SettingsButtonProps) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={`flex h-10 w-10 items-center justify-center rounded-full border border-zinc-300 text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900 ${className}`.trim()}
    >
      <Settings2 className="h-5 w-5" aria-hidden="true" strokeWidth={1.8} />
    </Link>
  );
}
