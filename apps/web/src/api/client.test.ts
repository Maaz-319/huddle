import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient, isApiError } from './client'

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiClient error handling', () => {
  it('surfaces Retry-After seconds on a 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            429,
            { error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded' } },
            { 'Retry-After': '7' },
          ),
        ),
      ),
    )

    const error = await apiClient.get('/servers').catch((e: unknown) => e)

    expect(isApiError(error)).toBe(true)
    if (isApiError(error)) {
      expect(error.status).toBe(429)
      expect(error.message).toBe('Too many requests — try again in 7s')
    }
  })

  it('falls back to a plain 429 message when Retry-After is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(429, { error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded' } }))),
    )

    const error = await apiClient.get('/servers').catch((e: unknown) => e)

    expect(isApiError(error)).toBe(true)
    if (isApiError(error)) {
      expect(error.message).toBe('Too many requests')
    }
  })

  it('unwraps the backend { error: { message } } envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(403, {
            error: {
              code: 'FORBIDDEN',
              message: 'This server does not let members share the invite link',
            },
          }),
        ),
      ),
    )

    const error = await apiClient.get('/servers/1/invite').catch((e: unknown) => e)

    expect(isApiError(error)).toBe(true)
    if (isApiError(error)) {
      expect(error.status).toBe(403)
      expect(error.message).toBe(
        'This server does not let members share the invite link',
      )
    }
  })

  it('falls back to an HTTP status message for non-JSON bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('bad gateway', { status: 502 }))),
    )

    const error = await apiClient.get('/servers').catch((e: unknown) => e)

    expect(isApiError(error)).toBe(true)
    if (isApiError(error)) {
      expect(error.message).toBe('HTTP 502')
    }
  })
})
