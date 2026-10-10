import type { MeResponse } from '@/types/user'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

async function fetchWithAuth<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    if (response.status === 401) {
      // Let the caller handle 401 - they might want to clear auth state
      throw new Error('UNAUTHORIZED')
    }
    const error = await response.json().catch(() => ({ message: 'Request failed' }))
    throw new Error(error.message ?? `HTTP ${response.status}`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json()
}

export const authApi = {
  async getMe(): Promise<MeResponse> {
    return fetchWithAuth<MeResponse>('/auth/me')
  },

  async logout(): Promise<void> {
    await fetchWithAuth<void>('/auth/logout', { method: 'POST' })
  },

  async deleteAccount(): Promise<void> {
    await fetchWithAuth<void>('/auth/me', { method: 'DELETE' })
  },

  async getUsers(ids: string[]): Promise<MeResponse[]> {
    const params = new URLSearchParams()
    params.set('ids', ids.join(','))
    return fetchWithAuth<MeResponse[]>(`/auth/users?${params.toString()}`)
  },
}