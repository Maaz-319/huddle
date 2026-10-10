import * as Tabs from '@radix-ui/react-tabs'
import { cn } from './cn'
import type { ReactNode } from 'react'

export const TabsRoot = Tabs.Root

export interface TabsListProps extends React.ComponentPropsWithoutRef<typeof Tabs.List> {
  children: ReactNode
}

export function TabsList({ className, children, ...props }: TabsListProps) {
  return (
    <Tabs.List
      className={cn(
        'inline-flex h-10 items-center justify-center rounded-md bg-bg-raised p-1 text-text-secondary',
        className,
      )}
      {...props}
    >
      {children}
    </Tabs.List>
  )
}

export interface TabsTriggerProps extends React.ComponentPropsWithoutRef<typeof Tabs.Trigger> {
  children: ReactNode
}

export function TabsTrigger({ className, children, ...props }: TabsTriggerProps) {
  return (
    <Tabs.Trigger
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base',
        'data-[state=active]:bg-bg-base data-[state=active]:text-text-primary data-[state=active]:shadow-sm',
        'data-[state=inactive]:hover:bg-bg-overlay/50 data-[state=inactive]:hover:text-text-primary',
        className,
      )}
      {...props}
    >
      {children}
    </Tabs.Trigger>
  )
}

export interface TabsContentProps extends React.ComponentPropsWithoutRef<typeof Tabs.Content> {
  children: ReactNode
}

export function TabsContent({ className, children, ...props }: TabsContentProps) {
  return (
    <Tabs.Content
      className={cn('mt-2 ring-offset-bg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus', className)}
      {...props}
    >
      {children}
    </Tabs.Content>
  )
}