import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { User } from '@/types/user'
import { authApi } from '@/api/auth'
import { API_BASE } from '@/api/apiBase'

export interface AuthState {
  user: User | null
  isHydrated: boolean
  hydrate: () => Promise<void>
  login: () => void
  logout: () => Promise<void>
  deleteAccount: () => Promise<void>
  setUser: (user: User | null) => void
}

const STORAGE_KEY = 'huddle-auth'

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isHydrated: false,

hydrate: async () => {
        try {
          console.log('[authStore] hydrate: calling /auth/me');
          const response = await authApi.getMe()
          console.log('[authStore] hydrate: response:', response);
          set({ user: response, isHydrated: true })
          console.log('[authStore] hydrate: state set');
        } catch (e) {
          console.log('[authStore] hydrate: error:', e);
          set({ user: null, isHydrated: true })
        }
      },

      login: () => {
        window.location.href = `${API_BASE}/auth/github`
      },

      logout: async () => {
        try {
          await authApi.logout()
        } finally {
          set({ user: null })
          window.location.href = '/'
        }
      },

      deleteAccount: async () => {
        try {
          await authApi.deleteAccount()
        } finally {
          set({ user: null })
          window.location.href = '/'
        }
      },

      setUser: (user: User | null) => {
        set({ user })
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ user: state.user }),
    },
  ),
)
