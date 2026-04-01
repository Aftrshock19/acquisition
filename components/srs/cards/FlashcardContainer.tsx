"use client";

import type { ReactNode } from "react";

type FlashcardContainerProps = {
  title: ReactNode;
  navigation?: ReactNode;
  children: ReactNode;
};

export function FlashcardContainer({
  title,
  navigation,
  children,
}: FlashcardContainerProps) {
  return (
    <section className="relative rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      {navigation ? <div className="absolute inset-x-6 top-6">{navigation}</div> : null}
      <div className="flex min-h-9 items-start justify-center px-12 text-center">
        <p className="text-sm uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
          {title}
        </p>
      </div>
      {children}
    </section>
  );
}
