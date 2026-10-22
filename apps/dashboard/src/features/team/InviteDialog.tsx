import { useId, useState, type RefObject } from 'react';
import { Button } from '../../components/ui/Button';
import { Dialog, DialogClose } from '../../components/ui/Dialog';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { ApiError, errorMessage } from '../../lib/api';
import { createInvite, type Role } from './api';

export interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the one-time invite link; the caller keeps it in state only. */
  onCreated: (link: string) => void;
  returnFocusTo?: RefObject<HTMLElement | null>;
}

const ROLE_OPTIONS = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Errors {
  email?: string;
  form?: string;
}

export function InviteDialog({ open, onOpenChange, onCreated, returnFocusTo }: InviteDialogProps) {
  const formId = useId();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setEmail('');
    setRole('member');
    setErrors({});
    setSubmitting(false);
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_PATTERN.test(trimmed) || trimmed.length > 254) return setErrors({ email: 'Enter a valid email address' });
    setSubmitting(true);
    try {
      const { link } = await createInvite({ email: trimmed, role });
      onOpenChange(false);
      onCreated(link);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') setErrors({ email: err.message });
      else if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') setErrors({ email: 'Enter a valid email address' });
      else setErrors({ form: errorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      {...(returnFocusTo && { returnFocusTo })}
      title="Invite a member"
      description="You get a link to send them. It works once and expires after 72 hours."
      footer={
        <>
          <DialogClose asChild>
            <Button disabled={submitting}>Cancel</Button>
          </DialogClose>
          <Button type="submit" form={formId} variant="primary" loading={submitting}>
            Create invite
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
        {errors.form ? (
          <p role="alert" className="rounded-control bg-danger-subtle px-3 py-2 text-sm text-danger">
            {errors.form}
          </p>
        ) : null}
        <FormField label="Email" required error={errors.email}>
          <Input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setErrors({});
            }}
            autoComplete="off"
            spellCheck={false}
            maxLength={254}
          />
        </FormField>
        <FormField label="Role" hint="Admins can manage servers, users and invites.">
          <Select options={ROLE_OPTIONS} value={role} onChange={(e) => setRole(e.target.value as Role)} />
        </FormField>
      </form>
    </Dialog>
  );
}
