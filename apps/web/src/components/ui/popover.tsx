import * as Popover from '@radix-ui/react-popover'
import { cn } from './cn'

export const PopoverRoot = Popover.Root
export const PopoverTrigger = Popover.Trigger
export const PopoverAnchor = Popover.Anchor

export type PopoverContentProps = React.ComponentPropsWithoutRef<typeof Popover.Content>

export function PopoverContent({ className, sideOffset = 8, ...props }: PopoverContentProps) {
  return (
    <Popover.Portal>
      <Popover.Content
        className={cn(
          'bg-bg-overlay border border-border-subtle rounded-xl shadow-lg p-4 z-50',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          className,
        )}
        sideOffset={sideOffset}
        {...props}
      />
    </Popover.Portal>
  )
}
