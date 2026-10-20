import { Tabs } from 'radix-ui';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { CopyField } from '../../components/ui/CopyField';
import { Dialog } from '../../components/ui/Dialog';
import { mcpUrl } from './api';
import { clientSnippets } from './clientSnippets';

export interface KeyCreatedDialogProps {
  /** The new key, or null when there is nothing to show. The caller drops it in `onClose`. */
  plaintext: string | null;
  onClose: () => void;
  returnFocusTo?: React.RefObject<HTMLElement | null>;
}

const TAB_CLASS =
  'h-9 rounded-control px-3 text-[0.8125rem] font-medium text-fg-muted hover:text-fg data-[state=active]:bg-accent-subtle data-[state=active]:text-accent-text';

/**
 * Shows a new API key exactly once. It cannot be dismissed by Esc or an outside click, and "Close" stays
 * disabled until the user confirms they copied the key. The plaintext is only ever a prop here (held in
 * the caller's component state): no storage, no query cache.
 */
export function KeyCreatedDialog({ plaintext, onClose, returnFocusTo }: KeyCreatedDialogProps) {
  const [copied, setCopied] = useState(false);
  const open = plaintext !== null;

  // Forget the confirmation whenever the dialog closes, so the next key starts unconfirmed.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setCopied(false);
  }

  const snippets = plaintext === null ? null : clientSnippets(mcpUrl(), plaintext);

  return (
    <Dialog
      open={open}
      dismissible={false}
      size="lg"
      {...(returnFocusTo && { returnFocusTo })}
      title="Your new API key"
      description="Use it as a Bearer token from an MCP client."
      footer={
        <Button variant="primary" disabled={!copied} onClick={onClose}>
          Close
        </Button>
      }
    >
      {plaintext !== null && snippets !== null ? (
        <div className="flex flex-col gap-5">
          <p role="alert" className="rounded-control border border-warning/30 bg-warning-subtle px-3.5 py-3 text-sm text-warning">
            You will not see this key again. Copy it now and store it somewhere safe.
          </p>
          <CopyField label="API key" value={plaintext} />
          <Tabs.Root defaultValue="claudeCode" className="flex flex-col gap-3">
            <Tabs.List aria-label="Client setup" className="flex flex-wrap gap-1">
              <Tabs.Trigger value="claudeCode" className={TAB_CLASS}>
                Claude Code
              </Tabs.Trigger>
              <Tabs.Trigger value="cursor" className={TAB_CLASS}>
                Cursor
              </Tabs.Trigger>
              <Tabs.Trigger value="inspector" className={TAB_CLASS}>
                MCP Inspector
              </Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="claudeCode">
              <CopyField label="Claude Code command" value={snippets.claudeCode} multiline />
            </Tabs.Content>
            <Tabs.Content value="cursor">
              <CopyField label="Cursor configuration" value={snippets.cursor} multiline />
            </Tabs.Content>
            <Tabs.Content value="inspector">
              <CopyField label="MCP Inspector command" value={snippets.inspector} multiline />
            </Tabs.Content>
          </Tabs.Root>
          <Checkbox label="I have copied the key" checked={copied} onChange={(e) => setCopied(e.target.checked)} />
        </div>
      ) : null}
    </Dialog>
  );
}
