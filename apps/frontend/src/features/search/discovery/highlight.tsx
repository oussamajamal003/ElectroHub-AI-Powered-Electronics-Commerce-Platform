import type { ReactNode } from 'react';

/** Wraps the first case-insensitive occurrence of the query in <mark>; rendered as text nodes, never as HTML. */
export function highlight(label: string, query: string): ReactNode {
  const needle = query.trim().toLowerCase();
  const at = needle ? label.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return label;
  return <>{label.slice(0, at)}<mark>{label.slice(at, at + needle.length)}</mark>{label.slice(at + needle.length)}</>;
}
