import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import path from 'node:path'

function requiredEnv(env: Record<string, string>, name: string): string {
  if (!(name in env)) throw new Error(`Missing required web environment variable: ${name}`)
  return env[name]
}

function requiredHttpUrl(env: Record<string, string>, name: string): string {
  const value = requiredEnv(env, name)
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
    return url.origin
  } catch {
    throw new Error(`${name} must be a valid http:// or https:// URL`)
  }
}

function validateApiUrl(value: string): void {
  if (value === '') return
  try {
    const url = new URL(value)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== ''
    ) throw new Error()
  } catch {
    throw new Error('VITE_API_URL must be empty or a valid http:// or https:// origin')
  }
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, __dirname, '')
  // Required even when empty: empty explicitly selects same-origin API routing.
  validateApiUrl(requiredEnv(env, 'VITE_API_URL'))

  const config = {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  }

  if (command !== 'serve') return config

  const rawPort = requiredEnv(env, 'WEB_PORT')
  const port = Number(rawPort)
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('WEB_PORT must be an integer between 1 and 65535')
  }

  const apiProxyTarget = requiredHttpUrl(env, 'API_PROXY_TARGET')
  const allowedHosts = requiredEnv(env, 'WEB_ALLOWED_HOSTS')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean)

  if (allowedHosts.some((host) => host.includes('://') || host.includes('/') || host.includes(' '))) {
    throw new Error('WEB_ALLOWED_HOSTS must be a comma-separated list of hostnames')
  }

  return {
    ...config,
    server: {
      port,
      strictPort: true,
      allowedHosts,
      proxy: {
        '/auth': { target: apiProxyTarget, changeOrigin: true, ws: true },
        '/api': { target: apiProxyTarget, changeOrigin: true },
        '/servers': { target: apiProxyTarget, changeOrigin: true },
        '/channels': { target: apiProxyTarget, changeOrigin: true },
        '/invites': { target: apiProxyTarget, changeOrigin: true },
        '/presence': { target: apiProxyTarget, changeOrigin: true },
        '/health': { target: apiProxyTarget, changeOrigin: true },
        '/socket.io': { target: apiProxyTarget, ws: true },
      },
    },
  }
})
