import * as SeparatorPrimitive from '@radix-ui/react-separator'
import { cn } from './cn'

export const SeparatorRoot = SeparatorPrimitive.Root

export interface SeparatorProps extends React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root> {
  orientation?: 'horizontal' | 'vertical'
  decorative?: boolean
}

export function SeparatorComp({ className, orientation = 'horizontal', decorative = true, ...props }: SeparatorProps) {
  return (
    <SeparatorPrimitive.Root
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'bg-border-subtle shrink-0',
        orientation === 'horizontal' ? 'h-[1px] w-full' : 'h-full w-[1px]',
        className,
      )}
      {...props}
    />
  )
}

export const Separator = SeparatorComp