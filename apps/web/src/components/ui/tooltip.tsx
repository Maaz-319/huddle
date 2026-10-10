import * as Tooltip from '@radix-ui/react-tooltip'
import { cn } from './cn'
import type { ReactNode } from 'react'

export const TooltipProvider = Tooltip.Provider

export const TooltipRoot = Tooltip.Root

export interface TooltipTriggerProps extends React.ComponentPropsWithoutRef<typeof Tooltip.Trigger> {
  children: ReactNode
}

export function TooltipTrigger({ className, children, ...props }: TooltipTriggerProps) {
  return <Tooltip.Trigger className={cn(className)} {...props}>{children}</Tooltip.Trigger>
}

export interface TooltipContentProps extends React.ComponentPropsWithoutRef<typeof Tooltip.Content> {
  children: ReactNode
}

export function TooltipContent({ className, side = 'top', align = 'center', sideOffset = 8, children, ...props }: TooltipContentProps) {
  return (
    <Tooltip.Content
      className={cn(
        'bg-bg-overlay border border-border-subtle rounded-md px-3 py-1.5 text-xs text-text-primary shadow-lg',
        'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out',
        'data-[state=delayed-open]:fade-in-0 data-[state=closed]:fade-out-0',
        'data-[side=top]:slide-in-from-bottom-2 data-[side=bottom]:slide-in-from-top-2',
        'data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2',
        className,
      )}
      side={side}
      align={align}
      sideOffset={sideOffset}
      {...props}
    >
      {children}
      <Tooltip.Arrow className="fill-bg-overlay border-border-subtle stroke-border-subtle" width={8} height={4} />
    </Tooltip.Content>
  )
}