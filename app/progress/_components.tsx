import type { ReactNode } from "react";

export type CardTone = "default" | "strong" | "muted";

export type HeroMetaItem = {
  label: string;
  value: string;
  detail: string;
};

export type CefrLadderRowData = {
  label: string;
  range: string;
  status: string;
  percent: number;
  detail: string;
  ariaLabel: string;
  tone: "completed" | "active" | "pending";
};

type StatCardProps = {
  label: string;
  value: string;
  detail: string;
  tone?: CardTone;
  className?: string;
  badge?: string;
};

type ProgressHeroCardProps = {
  eyebrow: string;
  badge: string;
  title: string;
  description: string;
  value: string;
  progressLabel: string;
  progressPercent: number;
  progressAriaLabel: string;
  helper: string;
  meta: HeroMetaItem[];
};

type SecondaryMetricCardProps = {
  label: string;
  value: string;
  detail: string;
  emphasis?: string;
};

export function StatCard({
  label,
  value,
  detail,
  tone = "default",
  className = "",
  badge,
}: StatCardProps) {
  return (
    <article className={`${getCardClassName(tone)} flex flex-col gap-4 p-4 ${className}`.trim()}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
          {label}
        </p>
        {badge ? (
          <span className="rounded-full bg-zinc-900 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-white dark:bg-zinc-100 dark:text-zinc-900">
            {badge}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          {value}
        </p>
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">{detail}</p>
      </div>
    </article>
  );
}

export function ProgressHeroCard({
  eyebrow,
  badge,
  title,
  description,
  value,
  progressLabel,
  progressPercent,
  progressAriaLabel,
  helper,
  meta,
}: ProgressHeroCardProps) {
  return (
    <section className="app-card-strong grid gap-6 p-6 md:grid-cols-[minmax(0,1.4fr)_minmax(220px,0.9fr)] md:p-8">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
            {eyebrow}
          </p>
          <span className="rounded-full bg-zinc-900 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-white dark:bg-zinc-100 dark:text-zinc-900">
            {badge}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {title}
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            {description}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-4xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-5xl">
            {value}
          </p>
          <ProgressBar
            ariaLabel={progressAriaLabel}
            percent={progressPercent}
            heightClassName="h-2.5"
            fillClassName="bg-zinc-900/75 dark:bg-zinc-100/80"
          />
          <div className="flex items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
            <span>{progressLabel}</span>
            <span>{Math.round(progressPercent)}%</span>
          </div>
        </div>

        <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">{helper}</p>
      </div>

      <div className="grid gap-3 self-start">
        {meta.map((item) => (
          <div key={item.label} className="app-card-muted flex flex-col gap-2 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
              {item.label}
            </p>
            <p className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              {item.value}
            </p>
            <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">{item.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CefrLadder({ rows }: { rows: CefrLadderRowData[] }) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <CefrLadderRow key={row.label} row={row} />
      ))}
    </div>
  );
}

export function SecondaryMetricCard({
  label,
  value,
  detail,
  emphasis,
}: SecondaryMetricCardProps) {
  return (
    <article className="app-card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
          {label}
        </p>
        {emphasis ? (
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{emphasis}</span>
        ) : null}
      </div>
      <p className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        {value}
      </p>
      <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">{detail}</p>
    </article>
  );
}

function CefrLadderRow({ row }: { row: CefrLadderRowData }) {
  return (
    <article className="app-card-muted flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              {row.label}
            </h3>
            <StatusPill tone={row.tone}>{row.status}</StatusPill>
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{row.range}</p>
        </div>
        <div className="text-right">
          <p className="text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {Math.round(row.percent)}%
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">within band</p>
        </div>
      </div>

      <ProgressBar
        ariaLabel={row.ariaLabel}
        percent={row.percent}
        heightClassName="h-1.5"
        fillClassName={getLadderFillClassName(row.tone)}
      />

      <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">{row.detail}</p>
    </article>
  );
}

function ProgressBar({
  ariaLabel,
  percent,
  heightClassName,
  fillClassName,
}: {
  ariaLabel: string;
  percent: number;
  heightClassName: string;
  fillClassName: string;
}) {
  return (
    <div
      className={`${heightClassName} overflow-hidden rounded-full bg-zinc-200/90 dark:bg-zinc-800/90`}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
    >
      <div
        className={`${heightClassName} rounded-full transition-[width] duration-500 ease-out ${fillClassName}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function StatusPill({
  children,
  tone,
}: {
  children: ReactNode;
  tone: CefrLadderRowData["tone"];
}) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] ${getStatusPillClassName(
        tone,
      )}`}
    >
      {children}
    </span>
  );
}

function getCardClassName(tone: CardTone) {
  if (tone === "strong") return "app-card-strong";
  if (tone === "muted") return "app-card-muted";
  return "app-card";
}

function getLadderFillClassName(tone: CefrLadderRowData["tone"]) {
  if (tone === "completed") return "bg-zinc-900 dark:bg-zinc-100";
  if (tone === "active") return "bg-zinc-900/70 dark:bg-zinc-100/80";
  return "bg-zinc-400/40 dark:bg-zinc-500/40";
}

function getStatusPillClassName(tone: CefrLadderRowData["tone"]) {
  if (tone === "completed") {
    return "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900";
  }

  if (tone === "active") {
    return "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100";
  }

  return "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400";
}
