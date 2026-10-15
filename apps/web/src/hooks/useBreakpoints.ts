import { useSyncExternalStore } from 'react';

const MOBILE_QUERY = '(max-width: 639px)';
const TABLET_QUERY = '(min-width: 640px) and (max-width: 1023px)';

function subscribe(query: string, callback: () => void) {
  const mql = window.matchMedia(query);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getSnapshot(query: string) {
  return window.matchMedia(query).matches;
}

function getServerSnapshot() {
  return false;
}

export function useBreakpoints() {
  const isMobile = useSyncExternalStore(
    (cb) => subscribe(MOBILE_QUERY, cb),
    () => getSnapshot(MOBILE_QUERY),
    getServerSnapshot,
  );

  const isTablet = useSyncExternalStore(
    (cb) => subscribe(TABLET_QUERY, cb),
    () => getSnapshot(TABLET_QUERY),
    getServerSnapshot,
  );

  return { isMobile, isTablet };
}
