import { cn } from '@/components/ui/cn';
import { Button } from '@/components/ui/button';
import { RefreshCw, AlertTriangle } from 'lucide-react';

interface FeatureErrorFallbackProps {
  title: string;
  description?: string;
  onRetry: () => void;
  retrying?: boolean;
}

export function FeatureErrorFallback({
  title,
  description,
  onRetry,
  retrying = false,
}: FeatureErrorFallbackProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center p-8 text-center',
        'bg-bg-base border border-border-subtle rounded-lg',
      )}
      role="alert"
    >
      <AlertTriangle className="h-12 w-12 text-accent-warn mb-4" />
      <h3 className="text-text-primary text-lg font-medium mb-2">{title}</h3>
      {description && (
        <p className="text-text-muted text-sm mb-6 max-w-md">{description}</p>
      )}
      <Button
        onClick={onRetry}
        disabled={retrying}
        className="w-full sm:w-auto"
      >
        {retrying ? (
          <>
            <RefreshCw className="h-4 w-4 animate-spin mr-2" />
            Retrying...
          </>
        ) : (
          <>
            <RefreshCw className="h-4 w-4 mr-2" />
            Try Again
          </>
        )}
      </Button>
    </div>
  );
}

export function createFeatureErrorFallback(
  featureName: string,
  onRetry: () => void,
  retrying?: boolean,
) {
  return function FeatureErrorFallbackComponent() {
    return (
      <FeatureErrorFallback
        title={`Failed to load ${featureName}`}
        description="Something went wrong while loading this section. Please try again."
        onRetry={onRetry}
        retrying={retrying}
      />
    );
  };
}