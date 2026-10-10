import * as ScrollArea from '@radix-ui/react-scroll-area'
import { cn } from './cn'
import type { ReactNode } from 'react'

export const ScrollAreaRoot = ScrollArea.Root

export interface ScrollAreaViewportProps extends React.ComponentPropsWithoutRef<typeof ScrollArea.Viewport> {
  children: ReactNode
}

export function ScrollAreaViewport({ className, children, ...props }: ScrollAreaViewportProps) {
  return (
    <ScrollArea.Viewport
      className={cn(
        'h-full w-full rounded-[inherit]',
        className,
      )}
      {...props}
    >
      {children}
    </ScrollArea.Viewport>
  )
}

export const ScrollAreaScrollbar = ScrollArea.Scrollbar

export interface ScrollAreaProps extends React.ComponentPropsWithoutRef<typeof ScrollArea.Root> {
  children: ReactNode
}

export function ScrollAreaComp({ className, children, ...props }: ScrollAreaProps) {
  return (
    <ScrollArea.Root className={cn('relative overflow-hidden', className)} {...props}>
      <ScrollAreaViewport className="h-full w-full">{children}</ScrollAreaViewport>
      <ScrollArea.Scrollbar
        orientation="vertical"
        className={cn(
          'flex h-full w-2.5',
          'data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2.5',
          'data-[orientation=horizontal]:h-2.5 data-[orientation=horizontal]:w-full',
        )}
      >
        <ScrollArea.Thumb className={cn(
          'relative flex-1 rounded-full bg-border-subtle/50 transition-colors',
          'hover:bg-border-subtle data-[active]:bg-border-subtle',
          'data-[orientation=vertical]:mx-1 data-[orientation=horizontal]:my-1',
        )} />
      </ScrollArea.Scrollbar>
      <ScrollArea.Scrollbar
        orientation="horizontal"
        className={cn(
          'flex h-2.5 w-full',
          'data-[orientation=vertical]:h-2.5 data-[orientation=vertical]:w-full',
          'data-[orientation=horizontal]:h-full data-[orientation=horizontal]:w-2.5',
        )}
      >
        <ScrollArea.Thumb className={cn(
          'relative flex-1 rounded-full bg-border-subtle/50 transition-colors',
          'hover:bg-border-subtle data-[active]:bg-border-subtle',
          'data-[orientation=vertical]:mx-1 data-[orientation=horizontal]:my-1',
        )} />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  )
}