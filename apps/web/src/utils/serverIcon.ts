/** A server icon may be remote, but it must use HTTPS. */
export function safeServerIconUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}
