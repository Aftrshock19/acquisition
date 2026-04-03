"use client";

import { BookOpen, Headphones, Languages } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/today", label: "Vocab", icon: Languages },
  { href: "/reading", label: "Reading", icon: BookOpen },
  { href: "/listening", label: "Listening", icon: Headphones },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-50">
      <div className="app-card-strong flex w-full items-stretch justify-between gap-2 rounded-none border-x-0 border-b-0 px-3 py-1.5 shadow-2xl shadow-zinc-900/10 md:px-4 md:py-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
              className={[
                "flex min-w-0 flex-1 items-center justify-center rounded-2xl px-2 py-2.5 text-sm font-medium tracking-tight text-zinc-500",
                "hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                "md:px-4 md:py-3 md:text-center",
              ].join(" ")}
            >
              <span
                className={[
                  "flex h-9 w-9 items-center justify-center rounded-full transition-colors md:h-10 md:w-10",
                  isActive
                    ? "text-zinc-950 dark:text-zinc-50"
                    : "text-current",
                ].join(" ")}
              >
                <Icon aria-hidden="true" className="h-5 w-5 md:h-6 md:w-6" />
              </span>
              <span className="sr-only">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
