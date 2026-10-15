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
  const baseStyles = 'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 bg-bg-overlay border border-border-subtle rounded-lg shadow-lg max-w-lg w-full'
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
          'sm:max-w-lg',
          className,
        )}
        {...props}
      >
        {children}
        <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-bg-base transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-border-focus focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-bg-raised data-[state=open]:text-text-primary">
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
    <Dialog.Title className={cn('text-lg font-semibold text-text-primary', className)} {...props}>
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