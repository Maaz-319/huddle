import * as RadioGroup from '@radix-ui/react-radio-group'
import { cn } from './cn'

export const RadioGroupRoot = RadioGroup.Root

export interface RadioGroupItemProps extends React.ComponentPropsWithoutRef<typeof RadioGroup.Item> {
  value: string;
}

export function RadioGroupItem({ className, ...props }: RadioGroupItemProps) {
  return (
    <RadioGroup.Item
      className={cn(
        'aspect-square h-4 w-4 rounded-full border border-border-subtle text-accent-primary',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2',
        'data-[state=checked]:bg-accent-primary data-[state=checked]:border-accent-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RadioGroup.Indicator className="flex items-center justify-center">
        <span className="h-2 w-2 rounded-full bg-current" />
      </RadioGroup.Indicator>
    </RadioGroup.Item>
  )
}