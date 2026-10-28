import * as Dialog from '@radix-ui/react-dialog'
import { cn } from './cn'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export const DialogRoot = Dialog.Root
export const DialogPortal = Dialog.Portal
export const DialogTrigger = Dialog.Trigger

export interface DialogContentProps extends React.ComponentPropsWithoutRef<typeof Dialog.Content> {
  children: ReactNode
  variant?: 'modal' | 'alert' | 'confirm'
}

export function DialogContent({ className, variant = 'modal', children, ...props }: DialogContentProps) {
  const baseStyles = 'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-border-subtle bg-bg-overlay p-5 text-text-primary shadow-lg sm:p-6'
  const variantStyles = {
    modal: 'max-w-md',
    alert: 'max-w-sm',
    confirm: 'max-w-sm',
  }

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <Dialog.Content
        className={cn(
          baseStyles,
          variantStyles[variant],
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          'data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'data-[state=open]:slide-in-from-top-4 data-[state=closed]:slide-out-to-top-4',
          className,
        )}
        {...props}
      >
        {children}
        <Dialog.Close className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-raised hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-overlay disabled:pointer-events-none sm:right-4 sm:top-4">
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Close</span>
        </Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  )
}

export interface DialogTitleProps extends React.ComponentPropsWithoutRef<typeof Dialog.Title> {
  children: ReactNode
}

export function DialogTitle({ className, children, ...props }: DialogTitleProps) {
  return (
    <Dialog.Title className={cn('text-lg font-semibold text-text-primary pr-8', className)} {...props}>
      {children}
    </Dialog.Title>
  )
}

export interface DialogDescriptionProps extends React.ComponentPropsWithoutRef<typeof Dialog.Description> {
  children: ReactNode
}

export function DialogDescription({ className, children, ...props }: DialogDescriptionProps) {
  return (
    <Dialog.Description className={cn('text-sm text-text-secondary mt-1', className)} {...props}>
      {children}
    </Dialog.Description>
  )
}

export interface DialogActionsProps extends React.ComponentPropsWithoutRef<'div'> {
  children: ReactNode
}

export function DialogActions({ className, children, ...props }: DialogActionsProps) {
  return (
    <div className={cn('flex items-center justify-end gap-3 mt-6', className)} {...props}>
      {children}
    </div>
  )
}

export const DialogClose = Dialog.Close
export const DialogHeader = Dialog.Title
export const DialogFooter = DialogActions
