import { forwardRef, type TextareaHTMLAttributes, useEffect, useRef } from 'react'
import { cn } from './cn'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  maxLength?: number
  showCounter?: boolean
  autoResize?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, maxLength, showCounter = false, autoResize = true, id, ...props }, ref) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const combinedRef = (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    }

    // Auto-resize effect
    useEffect(() => {
      if (autoResize && textareaRef.current) {
        const textarea = textareaRef.current
        textarea.style.height = 'auto'
        textarea.style.height = `${textarea.scrollHeight}px`
      }
    }, [autoResize, props.value, props.defaultValue])

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (autoResize) {
        // Trigger re-render for auto-resize
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
          }
        }, 0)
      }
      props.onChange?.(e)
    }

    const textareaId = id || label?.toLowerCase().replace(/\s+/g, '-')
    const errorId = `${textareaId}-error`
    const counterId = `${textareaId}-counter`
    const hasError = !!error

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={textareaId} className="block text-sm font-medium text-text-secondary mb-1.5">
            {label}
          </label>
        )}
        <div className="relative">
          <textarea
            ref={combinedRef}
            id={textareaId}
            className={cn(
              'w-full bg-bg-raised border border-border-subtle rounded-lg text-text-primary placeholder-text-muted resize-none',
              'transition-colors duration-150',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:border-transparent',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'placeholder:text-text-muted',
              hasError ? 'border-accent-warn focus-visible:ring-accent-warn' : '',
              'px-4 py-3',
              className,
            )}
            aria-invalid={hasError}
            aria-describedby={`${hasError ? errorId : ''} ${showCounter && maxLength ? counterId : ''}`.trim() || undefined}
            onChange={handleChange}
            {...props}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          {hasError && (
            <p id={errorId} className="text-sm text-accent-warn" role="alert">
              {error}
            </p>
          )}
          {showCounter && maxLength && (
            <p id={counterId} className="text-xs text-text-muted" aria-live="polite">
              {(props.value as string)?.length || 0} / {maxLength}
            </p>
          )}
        </div>
      </div>
    )
  },
)

Textarea.displayName = 'Textarea'