/** Reporting date helpers. All persisted instants remain UTC; boundaries are resolved in the store's IANA zone. */
const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();
const formatter = (timeZone: string) => {
  let value = formatters.get(timeZone);
  if (!value) { value = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); formatters.set(timeZone, value); }
  return value;
};
const parts = (date: Date, timeZone: string) => Object.fromEntries(formatter(timeZone).formatToParts(date).map(part => [part.type, Number(part.value)]));

function dateKey(year: number, month: number, day: number) { return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }

export function localDateStartForKey(targetKey: string, timeZone: string): Date {
  const [year, month, day] = targetKey.split('-').map(Number);
  const target = Date.UTC(year!, month! - 1, day!);
  let low = target - 36 * 60 * 60 * 1000;
  let high = target + 36 * 60 * 60 * 1000;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (localDateKey(new Date(mid), timeZone) >= targetKey) high = mid;
    else low = mid + 1;
  }
  return new Date(low);
}

/** Resolve a wall-clock midnight to its UTC instant, including DST transitions. */
export function localDateStart(date: Date, timeZone: string): Date {
  const p = parts(date, timeZone);
  // Find the first instant whose civil date is the target date. This handles unusual midnight transitions,
  // skipped wall-clock times, and offsets as large as UTC+14 without assuming the offset at UTC noon.
  return localDateStartForKey(dateKey(p.year!, p.month!, p.day!), timeZone);
}

export function addLocalDays(start: Date, days: number, timeZone: string): Date {
  const p = parts(start, timeZone);
  return localDateStart(new Date(Date.UTC(p.year!, p.month! - 1, p.day! + days, 12)), timeZone);
}

export function localMonthStart(date: Date, monthOffset: number, timeZone: string): Date {
  const p = parts(date, timeZone);
  const monthDate = new Date(Date.UTC(p.year!, p.month! - 1 + monthOffset, 1));
  return localDateStartForKey(dateKey(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 1), timeZone);
}

export function localDayWindow(now: Date, days: number, timeZone: string) {
  const today = localDateStart(now, timeZone);
  const since = addLocalDays(today, -(days - 1), timeZone);
  return { today, since, end: addLocalDays(today, 1, timeZone), previousSince: addLocalDays(since, -days, timeZone) };
}

export function localDateKey(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function storeTimeZone(value: string | null | undefined): string {
  if (!value) return 'UTC';
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return value; } catch { return 'UTC'; }
}

export const reportingDayMs = DAY_MS;
