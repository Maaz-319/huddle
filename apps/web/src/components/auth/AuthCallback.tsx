import { useEffect } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { authApi } from '@/api/auth'
import { router } from '@/router'

export function AuthCallback() {
  const { setUser } = useAuthStore()

  useEffect(() => {
    async function handleCallback() {
      try {
        const response = await authApi.getMe()
        setUser(response.user)
        router.navigate({ to: '/app' })
      } catch {
        setUser(null)
        router.navigate({ to: '/' })
      }
    }
    handleCallback()
  }, [setUser])

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-base">
      <div className="flex items-center gap-3 text-text-secondary">
        <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span>Completing sign in...</span>
      </div>
    </div>
  )
}