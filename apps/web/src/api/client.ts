const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export interface ApiError extends Error {
  status: number;
  data?: unknown;
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof Error && 'status' in error;
}

function createApiError(message: string, status: number, data?: unknown): ApiError {
  const error = new Error(message) as ApiError;
  error.status = status;
  error.data = data;
  error.name = 'ApiError';
  return error;
}

function extractErrorMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  if ('message' in body && typeof body.message === 'string') {
    return body.message;
  }
  if (
    'error' in body &&
    typeof body.error === 'object' &&
    body.error !== null &&
    'message' in body.error &&
    typeof body.error.message === 'string'
  ) {
    return body.error.message;
  }
  return undefined;
}

async function fetchWithAuth<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw createApiError('Unauthorized', 401);
    }
    const body = await response.json().catch(() => undefined);

    if (response.status === 429) {
      const retryAfter = Number.parseInt(response.headers.get('Retry-After') ?? '', 10);
      throw createApiError(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? `Too many requests — try again in ${retryAfter}s`
          : 'Too many requests',
        429,
        body,
      );
    }

    throw createApiError(
      extractErrorMessage(body) ?? `HTTP ${response.status}`,
      response.status,
      body,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export const apiClient = {
  get<T>(path: string): Promise<T> {
    return fetchWithAuth<T>(path);
  },

  post<T>(path: string, body?: unknown): Promise<T> {
    return fetchWithAuth<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  patch<T>(path: string, body?: unknown): Promise<T> {
    return fetchWithAuth<T>(path, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  put<T>(path: string, body?: unknown): Promise<T> {
    return fetchWithAuth<T>(path, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  delete<T>(path: string): Promise<T> {
    return fetchWithAuth<T>(path, {
      method: 'DELETE',
    });
  },
};