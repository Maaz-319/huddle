/**
 * User type matching backend MeResponse from apps/api/src/auth/auth.controller.ts
 * All IDs are Snowflakes represented as strings in JSON.
 */
export interface User {
  id: string
  username: string
  avatarUrl: string
  email: string
  bio: string | null
}

/**
 * Auth response from GET /auth/me - backend returns User directly
 */
export type MeResponse = User