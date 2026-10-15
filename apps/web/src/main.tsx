import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'
import { useAuthStore } from './stores/authStore'
import { TooltipProvider } from './components/ui'
import './index.css'

// Initialize auth store hydration on app start
useAuthStore.getState().hydrate()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider delayDuration={300}>
      <RouterProvider router={router} />
    </TooltipProvider>
  </StrictMode>,
)
