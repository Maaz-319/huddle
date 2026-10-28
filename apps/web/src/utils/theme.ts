export type ThemePreference = 'system' | 'light' | 'dark';

const THEME_STORAGE_KEY = 'huddle-theme';
const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function applyThemePreference(preference: ThemePreference): void {
  if (typeof document === 'undefined') return;

  const followsDarkSystem =
    typeof window !== 'undefined' &&
    window.matchMedia(DARK_SCHEME_QUERY).matches;
  const theme =
    preference === 'system'
      ? followsDarkSystem
        ? 'dark'
        : 'light'
      : preference;

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The selection still applies for this page when browser storage is blocked.
  }
  applyThemePreference(preference);
}

export function initializeTheme(): void {
  applyThemePreference(readThemePreference());

  if (typeof window === 'undefined') return;

  window.matchMedia(DARK_SCHEME_QUERY).addEventListener('change', () => {
    if (readThemePreference() === 'system') applyThemePreference('system');
  });
}
