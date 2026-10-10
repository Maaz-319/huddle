# 01: Project Setup — Vite + React + TypeScript + Tailwind

**What to build:** Initialize the `apps/web` workspace with a working React + TypeScript + Vite application, Tailwind CSS configured with the design tokens, and all core dependencies installed. The dev server runs and serves a minimal "Huddle" page.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `npm create vite@latest apps/web -- --template react-ts` from repo root
- [ ] Configure npm workspaces: `@huddle/web` in root `package.json` workspaces array
- [ ] Install core deps: `zustand`, `@tanstack/react-router`, `socket.io-client`, `react-hook-form`, `@hookform/resolvers`, `zod`, `lucide-react`, `clsx`, `tailwind-merge`
- [ ] Install Radix UI primitives: `@radix-ui/react-dropdown-menu`, `@radix-ui/react-dialog`, `@radix-ui/react-tooltip`, `@radix-ui/react-avatar`, `@radix-ui/react-scroll-area`, `@radix-ui/react-separator`, `@radix-ui/react-tabs`
- [ ] Install dev deps: `tailwindcss`, `postcss`, `autoprefixer`, `@types/react`, `@types/react-dom`
- [ ] Initialize Tailwind: `npx tailwindcss init -p` in `apps/web`
- [ ] Configure `tailwind.config.ts` with design tokens (colors, font family IBM Plex Sans, spacing scale, type scale)
- [ ] Configure `postcss.config.js` for Tailwind + Autoprefixer
- [ ] Add `@import "tailwindcss"` to global CSS
- [ ] Add IBM Plex Sans font import (Google Fonts or self-hosted via `@fontsource/ibm-plex-sans`)
- [ ] Configure TypeScript: strict mode, path aliases (`@/*` → `./src/*`)
- [ ] Add `dev`, `build`, `preview`, `lint`, `typecheck` scripts to `apps/web/package.json`
- [ ] Verify `npm run dev` from repo root starts the frontend on `http://localhost:5173` (or configured port)
- [ ] Add `.env.example` with `VITE_API_URL=http://localhost:3000` (backend), `VITE_WS_URL=ws://localhost:3000`