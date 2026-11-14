import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { formatPageTitle } from '@/lib/pageTitle';

/** Keep the browser title aligned with the rendered route, including lazy/data-loaded headings. */
export function usePageTitle(mainId: string, brand: string, headingPrefix?: string) {
  const { pathname } = useLocation();
  useEffect(() => {
    const main = document.getElementById(mainId);
    const update = () => {
      const heading = main?.querySelector('h1')?.textContent?.trim();
      const label = heading && headingPrefix && !heading.toLowerCase().startsWith(headingPrefix.toLowerCase()) ? `${headingPrefix} ${heading}` : heading;
      const title = formatPageTitle(label, brand);
      if (document.title !== title) document.title = title;
    };
    update();
    if (!main) return;
    const observer = new MutationObserver(update);
    observer.observe(main, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [mainId, brand, headingPrefix, pathname]);
}
