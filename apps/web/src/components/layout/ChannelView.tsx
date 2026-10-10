import { Outlet } from '@tanstack/react-router';
import { cn } from '@/components/ui/cn';

export function ChannelView() {
  return (
    <div className={cn(
      'flex flex-col h-full',
      'max-w-3xl mx-auto w-full'
    )}>
      <Outlet />
    </div>
  );
}