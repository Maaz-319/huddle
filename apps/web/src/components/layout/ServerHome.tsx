import { Hash, MessageSquare } from 'lucide-react';

export function ServerHome() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex h-16 items-center justify-between px-4 border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-accent-primary/20 flex items-center justify-center">
            <Hash className="h-5 w-5 text-accent-primary" />
          </div>
          <div>
            <h1 className="text-text-primary font-semibold">Server</h1>
            <p className="text-text-muted text-sm">Select a channel to start chatting</p>
          </div>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center p-8">
          <MessageSquare className="h-16 w-16 text-border-subtle mx-auto mb-4" />
          <h2 className="text-text-primary text-lg font-medium mb-2">No channel selected</h2>
          <p className="text-text-muted text-sm">Select a channel from the sidebar or create a new one</p>
        </div>
      </div>
    </div>
  );
}
