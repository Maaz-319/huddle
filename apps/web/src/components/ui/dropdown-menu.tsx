import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { cn } from './cn'

export const DropdownMenuRoot = DropdownMenu.Root
export const DropdownMenuTrigger = DropdownMenu.Trigger
export const DropdownMenuPortal = DropdownMenu.Portal

export type DropdownMenuContentProps = React.ComponentPropsWithoutRef<typeof DropdownMenu.Content>

export function DropdownMenuContent({ className, sideOffset = 8, alignOffset = 0, ...props }: DropdownMenuContentProps) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        className={cn(
          'bg-bg-overlay border border-border-subtle rounded-lg shadow-lg p-1 min-w-[180px]',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          className,
        )}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        {...props}
      />
    </DropdownMenu.Portal>
  )
}

export const DropdownMenuGroup = DropdownMenu.Group
export const DropdownMenuLabel = DropdownMenu.Label

export type DropdownMenuItemProps = React.ComponentPropsWithoutRef<typeof DropdownMenu.Item> & {
  shortcut?: string
}

export function DropdownMenuItem({ className, shortcut, children, ...props }: DropdownMenuItemProps) {
  return (
    <DropdownMenu.Item
      className={cn(
        'relative flex cursor-pointer items-center rounded-sm px-3 py-2 text-sm text-text-primary',
        'outline-none focus:bg-bg-raised focus:text-text-primary',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        'data-[highlighted]:bg-bg-raised data-[highlighted]:text-text-primary',
        className,
      )}
      {...props}
    >
      {children}
      {shortcut && (
        <span className="ml-auto text-xs text-text-muted tracking-wider">{shortcut}</span>
      )}
    </DropdownMenu.Item>
  )
}

export const DropdownMenuSeparator = DropdownMenu.Separator

export type DropdownMenuCheckboxItemProps = React.ComponentPropsWithoutRef<typeof DropdownMenu.CheckboxItem>

export function DropdownMenuCheckboxItem({ className, children, ...props }: DropdownMenuCheckboxItemProps) {
  return (
    <DropdownMenu.CheckboxItem
      className={cn(
        'relative flex cursor-pointer items-center rounded-sm px-3 py-2 text-sm text-text-primary',
        'outline-none focus:bg-bg-raised focus:text-text-primary',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-3 flex h-5 w-5 items-center justify-center">
        <DropdownMenu.ItemIndicator>
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </DropdownMenu.ItemIndicator>
      </span>
      <span className="pl-8">{children}</span>
    </DropdownMenu.CheckboxItem>
  )
}

export type DropdownMenuRadioGroupProps = React.ComponentPropsWithoutRef<typeof DropdownMenu.RadioGroup>

export function DropdownMenuRadioGroup({ className, ...props }: DropdownMenuRadioGroupProps) {
  return <DropdownMenu.RadioGroup className={cn(className)} {...props} />
}

export type DropdownMenuRadioItemProps = React.ComponentPropsWithoutRef<typeof DropdownMenu.RadioItem>

export function DropdownMenuRadioItem({ className, children, ...props }: DropdownMenuRadioItemProps) {
  return (
    <DropdownMenu.RadioItem
      className={cn(
        'relative flex cursor-pointer items-center rounded-sm px-3 py-2 text-sm text-text-primary',
        'outline-none focus:bg-bg-raised focus:text-text-primary',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-3 flex h-5 w-5 items-center justify-center">
        <DropdownMenu.ItemIndicator>
          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M10 2a8 8 0 108 8 8 8 0 00-8-8zm0 2a6 6 0 110 12 6 6 0 010-12z" />
          </svg>
        </DropdownMenu.ItemIndicator>
      </span>
      <span className="pl-8">{children}</span>
    </DropdownMenu.RadioItem>
  )
}

export const DropdownMenuSub = DropdownMenu.Sub
export const DropdownMenuSubTrigger = DropdownMenu.SubTrigger
export const DropdownMenuSubContent = DropdownMenu.SubContent