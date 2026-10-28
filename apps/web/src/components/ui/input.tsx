import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from './cn'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  leftElement?: ReactNode
  rightElement?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, leftElement, rightElement, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
    const errorId = `${inputId}-error`
    const hasError = !!error

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-text-secondary mb-1.5">
            {label}
          </label>
        )}
        <div className="relative">
          {leftElement && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
              {leftElement}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'min-h-11 w-full min-w-0 rounded-lg border border-border-subtle bg-bg-raised text-text-primary placeholder-text-muted',
              'transition-colors duration-150',
              'focus:outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:border-transparent',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'placeholder:text-text-muted',
              hasError ? 'border-accent-warn focus-visible:ring-accent-warn' : '',
              leftElement ? 'pl-10' : 'pl-4',
              rightElement ? 'pr-10' : 'pr-4',
              'py-2.5',
              className,
            )}
            aria-invalid={hasError}
            aria-describedby={hasError ? errorId : undefined}
            {...props}
          />
          {rightElement && (
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-text-muted">
              {rightElement}
            </div>
          )}
        </div>
        {hasError && (
          <p id={errorId} className="mt-1.5 text-sm text-accent-warn" role="alert">
            {error}
          </p>
        )}
      </div>
    )
  },
)

Input.displayName = 'Input'
