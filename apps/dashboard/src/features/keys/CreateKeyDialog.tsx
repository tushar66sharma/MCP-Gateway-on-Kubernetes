import { useId, useState, type RefObject } from 'react';
import { Button } from '../../components/ui/Button';
import { Dialog, DialogClose } from '../../components/ui/Dialog';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { ApiError, errorMessage } from '../../lib/api';
import type { CreatedKey } from './api';

export interface CreateKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Creates the key. The result goes to `onCreated` and is not kept here. */
  create: (name: string) => Promise<CreatedKey>;
  onCreated: (created: CreatedKey) => void;
  title?: string;
  returnFocusTo?: RefObject<HTMLElement | null>;
}

/** Asks for a key name (1-60 characters), then hands the created key to the caller. */
export function CreateKeyDialog({ open, onOpenChange, create, onCreated, title = 'Create API key', returnFocusTo }: CreateKeyDialogProps) {
  const formId = useId();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setName('');
    setError(undefined);
    setSubmitting(false);
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') return setError('Enter a name for the key');
    if (trimmed.length > 60) return setError('Use 60 characters or fewer');
    setSubmitting(true);
    try {
      const created = await create(trimmed);
      onOpenChange(false);
      onCreated(created);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'VALIDATION_FAILED' ? err.message : errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      {...(returnFocusTo && { returnFocusTo })}
      title={title}
      description="Name it after where it will be used, for example “laptop” or “CI”."
      footer={
        <>
          <DialogClose asChild>
            <Button disabled={submitting}>Cancel</Button>
          </DialogClose>
          <Button type="submit" form={formId} variant="primary" loading={submitting}>
            Create key
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(e) => void submit(e)} noValidate>
        <FormField label="Key name" required error={error}>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(undefined);
            }}
            autoComplete="off"
            maxLength={60}
          />
        </FormField>
      </form>
    </Dialog>
  );
}
