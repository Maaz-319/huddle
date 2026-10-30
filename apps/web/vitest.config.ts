import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The test environment deliberately exercises the same-origin API mode.
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(''),
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
