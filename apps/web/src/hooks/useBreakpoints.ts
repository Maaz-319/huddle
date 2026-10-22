import { useSyncExternalStore } from 'react';

/**
 * Single source of truth for "mobile mode": anything below the desktop
 * three-column layout gets the mobile header, bottom nav, and drawer-based
 * sidebars. Matches the CSS `lg:` breakpoint so the two can never disagree.
 */
const MOBILE_QUERY = '(max-width: 1023px)';

function subscribe(callback: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getSnapshot() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function getServerSnapshot() {
  return false;
}

export function useBreakpoints() {
  const isMobile = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { isMobile };
}
