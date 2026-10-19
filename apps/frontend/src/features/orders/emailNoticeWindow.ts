import { useEffect, useMemo, useState } from 'react';

/**
 * Task 03.8: the initial-email notice is a transient courtesy, not page content. It lives for NOTICE_LIFETIME_MS from the moment it first
 * becomes eligible for one (owner, order) in this browser session, across Confirmation, Orders and Order Details, and never returns.
 * UI visibility only: nothing here touches the backend outbox, delivery, or any API.
 */
export const NOTICE_LIFETIME_MS = 60_000;
/** Only an order placed this recently can ever start a window, so reopening a historical order never shows a fresh notice. */
export const NOTICE_ELIGIBLE_AGE_MS = 10 * 60_000;

const PREFIX = 'electrohub:email-notice:v1:';
// Fallback when sessionStorage is unavailable (private mode, blocked storage): still stable across navigation within the page session.
const memory = new Map<string, number>();

const storageKey = (ownerId: string, orderReference: string) => `${PREFIX}${ownerId}:${orderReference}`;

function readStart(key: string): number | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    const parsed = raw === null ? NaN : Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  } catch { /* storage blocked: use memory */ }
  return memory.get(key) ?? null;
}

function writeStart(key: string, value: number) {
  memory.set(key, value);
  try { window.sessionStorage.setItem(key, String(value)); } catch { /* memory copy still holds */ }
}

const recentEnough = (createdAt: string, now: number) => {
  const placed = Date.parse(createdAt);
  return Number.isFinite(placed) && now - placed <= NOTICE_ELIGIBLE_AGE_MS;
};

/** Pure read (no write): is a notice for this order currently inside its window, or still allowed to start one? Used to stop refresh polling. */
export function emailNoticeLive(ownerId: string, orderReference: string, createdAt: string | undefined, now = Date.now()): boolean {
  if (!ownerId || !orderReference) return false;
  const start = readStart(storageKey(ownerId, orderReference));
  if (start !== null) return now - start < NOTICE_LIFETIME_MS;
  return Boolean(createdAt) && recentEnough(createdAt!, now);
}

/** Returns the window's start (creating it on first eligible call), or null when the notice must not be shown. */
function ensureStart(ownerId: string, orderReference: string, createdAt: string | undefined, eligible: boolean, now: number): number | null {
  if (!eligible || !ownerId || !orderReference) return null;
  const key = storageKey(ownerId, orderReference);
  const existing = readStart(key);
  if (existing !== null) return existing;
  if (!createdAt || !recentEnough(createdAt, now)) return null;
  writeStart(key, now);
  return now;
}

export interface EmailNoticeWindowInput { ownerId: string; orderReference: string; createdAt?: string; eligible: boolean }

/**
 * True while the notice may be shown. Stable across rerenders, refetches and route changes (the start time is stored, never the timer).
 * One timeout per mounted notice, cleared on unmount, owner change or expiry. A changed owner never inherits another owner's window.
 */
export function useEmailNoticeWindow({ ownerId, orderReference, createdAt, eligible }: EmailNoticeWindowInput): boolean {
  const [now, setNow] = useState(() => Date.now());
  const start = useMemo(() => ensureStart(ownerId, orderReference, createdAt, eligible, Date.now()),
    // `createdAt` is part of identity only through eligibility at first sight; later rerenders reuse the stored start.
    [ownerId, orderReference, createdAt, eligible]);
  const remaining = start === null ? 0 : start + NOTICE_LIFETIME_MS - now;
  useEffect(() => {
    if (start === null) return undefined;
    const left = start + NOTICE_LIFETIME_MS - Date.now();
    if (left <= 0) { setNow(Date.now()); return undefined; }
    const timer = setTimeout(() => setNow(Date.now()), left);
    return () => clearTimeout(timer);
  }, [start]);
  return remaining > 0;
}

/** Test seam: forget every stored window. */
export function resetEmailNoticeWindows() {
  memory.clear();
  try {
    const stale: string[] = [];
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith(PREFIX)) stale.push(key);
    }
    stale.forEach(key => window.sessionStorage.removeItem(key));
  } catch { /* nothing to clear */ }
}
