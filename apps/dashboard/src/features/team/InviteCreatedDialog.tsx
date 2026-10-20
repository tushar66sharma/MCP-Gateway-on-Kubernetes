import { Button } from '../../components/ui/Button';
import { CopyField } from '../../components/ui/CopyField';
import { Dialog, DialogClose } from '../../components/ui/Dialog';

export interface InviteCreatedDialogProps {
  /** The invite link, or null when there is nothing to show. The caller drops it in `onClose`. */
  link: string | null;
  onClose: () => void;
  returnFocusTo?: React.RefObject<HTMLElement | null>;
}

/** Shows an invite link once. The link is a bearer secret: a prop here, never stored or cached. */
export function InviteCreatedDialog({ link, onClose, returnFocusTo }: InviteCreatedDialogProps) {
  return (
    <Dialog
      open={link !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      {...(returnFocusTo && { returnFocusTo })}
      title="Invite created"
      description="Send this link to the person you invited. You will not see it again."
      footer={
        <DialogClose asChild>
          <Button variant="primary">Done</Button>
        </DialogClose>
      }
    >
      {link !== null ? (
        <div className="flex flex-col gap-3">
          <CopyField label="Invite link" value={link} />
          <p className="text-[0.8125rem] text-fg-subtle">Valid for 72 hours, works once.</p>
        </div>
      ) : null}
    </Dialog>
  );
}
