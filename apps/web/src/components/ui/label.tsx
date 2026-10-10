import { cn } from '@/components/ui/cn'
import * as React from 'react'

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, ...props }, ref) => {
    return (
      <label
        className={cn(
          'text-sm font-medium text-text-primary',
          'select-none cursor-pointer',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Label.displayName = 'Label'