const STORAGE_KEY = 'huddle-return-to';

function isInternalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//');
}

/**
 * Remembers where the user was before an auth redirect (GitHub OAuth is a
 * full-page roundtrip, so the SPA can't carry the location itself). Only
 * same-origin absolute paths are stored or returned — an open redirect
 * through here would let a crafted link bounce users off-site after login.
 */
export function saveReturnTo(path: string): void {
  if (isInternalPath(path)) {
    sessionStorage.setItem(STORAGE_KEY, path);
  }
}

/** Takes the stored path (if any) and clears it; falls back when absent. */
export function consumeReturnTo(fallback: string): string {
  const value = sessionStorage.getItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  return value !== null && isInternalPath(value) ? value : fallback;
}
