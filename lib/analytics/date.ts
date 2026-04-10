const SESSION_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: getAppSessionTimeZone(),
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const LONG_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: getAppSessionTimeZone(),
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function getAppSessionTimeZone() {
  return process.env.APP_SESSION_TIME_ZONE ?? "Europe/London";
}

export function getAppSessionDate(date = new Date()) {
  const parts = SESSION_DATE_FORMATTER.formatToParts(date);
  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  const year = lookup.get("year");
  const month = lookup.get("month");
  const day = lookup.get("day");

  if (!year || !month || !day) {
    return date.toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

export function isValidSessionDate(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export function shiftSessionDate(sessionDate: string, deltaDays: number) {
  const utcDate = new Date(`${sessionDate}T00:00:00.000Z`);
  utcDate.setUTCDate(utcDate.getUTCDate() + deltaDays);
  return utcDate.toISOString().slice(0, 10);
}

export function getDefaultSessionDateRange(days: number) {
  const today = getAppSessionDate();
  return {
    from: shiftSessionDate(today, -(days - 1)),
    to: today,
  };
}

export function clampSessionDateRange(
  requestedFrom: string | null | undefined,
  requestedTo: string | null | undefined,
  fallbackDays = 14,
) {
  const fallback = getDefaultSessionDateRange(fallbackDays);
  const from = isValidSessionDate(requestedFrom) ? requestedFrom : fallback.from;
  const to = isValidSessionDate(requestedTo) ? requestedTo : fallback.to;

  if (from <= to) {
    return { from, to };
  }

  return { from: to, to: from };
}

export function formatSessionDateLabel(sessionDate: string) {
  return LONG_DATE_FORMATTER.format(new Date(`${sessionDate}T12:00:00.000Z`));
}
