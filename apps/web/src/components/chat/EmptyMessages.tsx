import { MessageSquare, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyMessagesProps {
  onCreateChannel?: () => void;
  hasChannels?: boolean;
}

export function EmptyMessages({ onCreateChannel, hasChannels = false }: EmptyMessagesProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="mb-6">
        <MessageSquare className="h-16 w-16 text-border-subtle mx-auto" />
      </div>
      <h2 className="text-text-primary text-lg font-medium mb-2">
        {hasChannels ? 'No messages yet' : 'No channel selected'}
      </h2>
      <p className="text-text-muted text-sm mb-6 max-w-xs">
        {hasChannels
          ? 'Start the conversation! Send the first message.'
          : 'Select a channel from the sidebar or create a new one'}
      </p>
      {hasChannels && onCreateChannel && (
        <Button variant="secondary" onClick={onCreateChannel}>
          <Plus className="h-4 w-4 mr-2" />
          Create Channel
        </Button>
      )}
    </div>
  );
}