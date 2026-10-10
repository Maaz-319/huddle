import { cn } from '@/components/ui/cn'
import * as React from 'react'

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  onCheckedChange?: (checked: boolean) => void;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, onCheckedChange, checked, ...props }, ref) => {
    return (
      <input
        type="checkbox"
        className={cn(
          'h-4 w-4 rounded border-border-subtle bg-bg-base',
          'text-accent-primary focus:ring-2 focus:ring-accent-primary/20',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'transition-colors duration-200',
          className
        )}
        ref={ref}
        checked={checked}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        {...props}
      />
    )
  }
)
Checkbox.displayName = 'Checkbox'