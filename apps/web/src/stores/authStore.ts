import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { User } from '@/types/user'
import { authApi } from '@/api/auth'

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
    (set, get) => ({
      user: null,
      isHydrated: false,

      hydrate: async () => {
        const { user } = get()
        if (user) {
          try {
            const response = await authApi.getMe()
            set({ user: response.user, isHydrated: true })
          } catch {
            // Session invalid, clear store
            set({ user: null, isHydrated: true })
          }
        } else {
          set({ isHydrated: true })
        }
      },

      login: () => {
        window.location.href = `${import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}/auth/github`
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
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isHydrated = true
        }
      },
    },
  ),
)