import { Outlet } from '@tanstack/react-router';
import { cn } from '@/components/ui/cn';

export function MessagePane() {
  return (
    <div className={cn(
      'flex flex-col flex-1 min-w-0',
      'max-w-3xl mx-auto w-full'
    )}>
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}