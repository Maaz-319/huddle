import { useAuthStore } from '@/stores/authStore'

/**
 * Convenience hook for accessing auth state and actions
 * Handles hydration state for conditional rendering
 */
export function useAuth() {
  const { user, isHydrated, hydrate, login, logout, deleteAccount, setUser } = useAuthStore()

  return {
    user,
    isHydrated,
    isAuthenticated: !!user,
    hydrate,
    login,
    logout,
    deleteAccount,
    setUser,
  }
}