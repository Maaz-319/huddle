const configuredApiUrl = import.meta.env.VITE_API_URL;

if (configuredApiUrl === undefined) {
  throw new Error('Missing required web environment variable: VITE_API_URL');
}

// An empty value deliberately means same-origin (for Vite proxy and tunnel setups).
let apiBase = '';
if (configuredApiUrl !== '') {
  let parsedApiUrl: URL;
  try {
    parsedApiUrl = new URL(configuredApiUrl);
  } catch {
    throw new Error('VITE_API_URL must be empty or a valid http:// or https:// origin');
  }

  if (
    (parsedApiUrl.protocol !== 'http:' && parsedApiUrl.protocol !== 'https:') ||
    parsedApiUrl.pathname !== '/' ||
    parsedApiUrl.search !== '' ||
    parsedApiUrl.hash !== ''
  ) {
    throw new Error('VITE_API_URL must be empty or a valid http:// or https:// origin');
  }
  apiBase = parsedApiUrl.origin;
}

export const API_BASE = apiBase;
