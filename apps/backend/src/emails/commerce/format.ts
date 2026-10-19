/** Locale-stable formatting for commerce emails. Pure: no floating point, all dates pinned to UTC. */

const MONEY_PATTERN = /^(\d{1,10})\.(\d{2})$/;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const LONG_DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });
const LONG_WEEKDAY_DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const SHORT_DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const SHORT_DATE_WITH_YEAR = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });

const CARD_BRANDS: Readonly<Record<string, string>> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
};

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Formats an exact decimal string such as "1234567.80" without floating point arithmetic. */
export function formatMoney(amount: string, currency: string): string {
  const match = MONEY_PATTERN.exec(amount);
  if (!match || !/^[A-Z]{3}$/.test(currency)) throw new Error('INVALID_MONEY');
  const grouped = `${groupThousands(match[1]!)}.${match[2]!}`;
  return currency === 'USD' ? `$${grouped}` : `${grouped} ${currency}`;
}

function parseDateOnly(value: string): Date {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) throw new Error('INVALID_DATE_ONLY');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('INVALID_DATE_ONLY');
  return date;
}

/** Formats a UTC instant as a calendar date, e.g. "October 18, 2026". */
export function formatInstant(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error('INVALID_INSTANT');
  return LONG_DATE.format(date);
}

/** Formats a stored date-only value (YYYY-MM-DD) without timezone shifts, e.g. "Friday, October 23, 2026". */
export function formatDateOnly(value: string): string {
  return LONG_WEEKDAY_DATE.format(parseDateOnly(value));
}

/** Formats an estimated delivery window. Equal bounds render as one date; otherwise "Oct 23 – Oct 27, 2026". */
export function formatEstimate(start: string, end: string): string {
  const startDate = parseDateOnly(start);
  const endDate = parseDateOnly(end);
  if (startDate.getTime() > endDate.getTime()) throw new Error('INVALID_ESTIMATE_RANGE');
  if (start === end) return formatDateOnly(start);
  if (start.slice(0, 4) === end.slice(0, 4)) {
    return `${SHORT_DATE.format(startDate)} – ${SHORT_DATE_WITH_YEAR.format(endDate)}`;
  }
  return `${SHORT_DATE_WITH_YEAR.format(startDate)} – ${SHORT_DATE_WITH_YEAR.format(endDate)}`;
}

/** Display name for a verified card brand. Unknown brands are title-cased with underscores replaced by spaces. */
export function formatCardBrand(brand: string): string {
  const known = CARD_BRANDS[brand];
  if (known) return known;
  return brand
    .split('_')
    .filter(word => word.length > 0)
    .map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}
