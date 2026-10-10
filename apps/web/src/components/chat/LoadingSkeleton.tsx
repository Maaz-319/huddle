interface LoadingSkeletonProps {
  count?: number;
}

export function LoadingSkeleton({ count = 5 }: LoadingSkeletonProps) {
  return (
    <div className="animate-pulse space-y-3 p-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex gap-3">
          <div className="h-8 w-8 rounded-full bg-bg-raised" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-bg-raised rounded w-1/4" />
            <div className="h-4 bg-bg-raised rounded w-1/2" />
            <div className="h-4 bg-bg-raised rounded w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}