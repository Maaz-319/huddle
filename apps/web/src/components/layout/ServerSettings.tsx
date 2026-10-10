import { cn } from '@/components/ui/cn';

export function ServerSettings() {
  return (
    <div className={cn(
      'flex flex-col h-full',
      'max-w-3xl mx-auto w-full p-8'
    )}>
      <h1 className="text-text-primary text-2xl font-semibold mb-4">Server Settings</h1>
      <p className="text-text-muted">Coming soon...</p>
    </div>
  );
}