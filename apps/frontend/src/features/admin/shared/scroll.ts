/**
 * After a page change, bring the page title (and the filters under it) back into view below the sticky header. Runs only from a
 * pager click, never on load, refetch or filter changes; reduced-motion users get an instant jump.
 */
export function scrollToContentTop() {
  const heading = document.querySelector<HTMLElement>('#admin-main h1');
  if (!heading) return;
  const target = () => {
    const header = document.querySelector<HTMLElement>('[data-admin-header]')?.offsetHeight ?? 0;
    return Math.max(0, heading.getBoundingClientRect().top + window.scrollY - header - 24);
  };
  if (Math.abs(window.scrollY - target()) < 2) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { window.scrollTo({ top: target(), behavior: 'auto' }); return; }
  window.scrollTo({ top: target(), behavior: 'smooth' });
  // The next page's rows can land mid-animation and change the page height, which stops a smooth scroll early. When scrolling ends
  // (or if it never starts), finish the move so the title is always back in view.
  const finish = () => {
    window.removeEventListener('scrollend', finish);
    window.clearTimeout(fallback);
    if (Math.abs(window.scrollY - target()) > 4) window.scrollTo({ top: target(), behavior: 'auto' });
  };
  const fallback = window.setTimeout(finish, 1000);
  window.addEventListener('scrollend', finish);
}
