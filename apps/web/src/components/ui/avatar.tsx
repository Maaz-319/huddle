import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cn } from './cn'

export const AvatarRoot = AvatarPrimitive.Root

export type AvatarImageProps = React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>

export function AvatarImage({ className, ...props }: AvatarImageProps) {
  return (
    <AvatarPrimitive.Image
      className={cn('aspect-square h-full w-full rounded-full object-cover', className)}
      {...props}
    />
  )
}

export type AvatarFallbackProps = React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>

export function AvatarFallback({ className, ...props }: AvatarFallbackProps) {
  return (
    <AvatarPrimitive.Fallback
      className={cn(
        'flex h-full w-full items-center justify-center rounded-full bg-accent-primary/20 text-accent-primary font-medium',
        className,
      )}
      {...props}
    />
  )
}

export interface AvatarProps {
  src?: string | null
  alt?: string
  name?: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  status?: 'online' | 'offline' | 'none'
  className?: string
}

const sizeStyles = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-lg',
}

const statusSizeStyles = {
  xs: 'h-2 w-2',
  sm: 'h-2.5 w-2.5',
  md: 'h-3 w-3',
  lg: 'h-3.5 w-3.5',
  xl: 'h-4 w-4',
}

export function Avatar({ src, alt, name, size = 'md', status = 'none', className, ...props }: AvatarProps) {
  const initials = name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?'

  return (
    <AvatarRoot className={cn('relative inline-flex shrink-0', className)} {...props}>
      <AvatarImage src={src ?? undefined} alt={alt || name || 'Avatar'} className={sizeStyles[size]} />
      <AvatarFallback className={sizeStyles[size]}>{initials}</AvatarFallback>
      {status !== 'none' && (
        <span
          className={cn(
            'absolute bottom-0 right-0 rounded-full border-2 border-bg-base',
            statusSizeStyles[size],
            status === 'online' ? 'bg-accent-electric' : 'bg-accent-muted',
          )}
          aria-label={status === 'online' ? 'Online' : 'Offline'}
        />
      )}
    </AvatarRoot>
  )
}