const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface ApiError extends Error {
  status: number;
  data?: unknown;
}

function createApiError(message: string, status: number, data?: unknown): ApiError {
  const error = new Error(message) as ApiError;
  error.status = status;
  error.data = data;
  error.name = 'ApiError';
  return error;
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
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw createApiError(
      typeof error === 'object' && error !== null && 'message' in error 
        ? String(error.message) 
        : `HTTP ${response.status}`,
      response.status,
      error
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