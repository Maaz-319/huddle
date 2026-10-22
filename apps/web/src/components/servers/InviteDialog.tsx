import { Button } from '@/components/ui/button';
import {
  DialogRoot as Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogActions as DialogFooter
} from '@/components/ui/dialog';
import { InvitePanel } from './InvitePanel';

interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverId: string;
}

export function InviteDialog({ open, onOpenChange, serverId }: InviteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>Invite People</DialogTitle>
        <DialogDescription>Share this link to invite others to your server</DialogDescription>

        <div className="py-4">
          <InvitePanel serverId={serverId} />
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
