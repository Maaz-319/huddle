# 02: Design System & UI Primitives

**What to build:** A set of reusable, accessible UI primitives built on Radix UI, styled with the design tokens. These are the building blocks every feature uses — no feature writes raw HTML/CSS for common patterns.

**Blocked by:** 01-project-setup

**Status:** ready-for-agent

- [ ] `Button` — variants: `primary` (accent-electric), `secondary` (bg-raised), `ghost`, `destructive` (accent-warn); sizes: `sm`, `md`, `lg`; loading state; `asChild` for link composition
- [ ] `Input` — label, error message, disabled, `leftElement`/`rightElement` slots (for icons)
- [ ] `Textarea` — auto-resize, character counter optional
- [ ] `DropdownMenu` (Radix) — trigger, content, item, separator, checkbox item, radio group, shortcut hint
- [ ] `Dialog` (Radix) — modal, alert, confirm variants; focus trap; `Escape` to close
- [ ] `Tooltip` (Radix) — delay, side/align options
- [ ] `Avatar` (Radix) — image + fallback (initials), sizes: `xs` (24px) through `xl` (64px), status indicator dot (online/offline)
- [ ] `ScrollArea` (Radix) — styled scrollbars, hover-visible
- [ ] `Separator` (Radix) — horizontal/vertical, decorative
- [ ] `Tabs` (Radix) — for settings sections, density toggle
- [ ] `TooltipProvider` wrapper for app-level default delay
- [ ] Utility: `cn(...classes)` using `clsx` + `tailwind-merge`
- [ ] All primitives export from `@/components/ui` barrel file
- [ ] Storybook or visual regression not required; manual verification in browser