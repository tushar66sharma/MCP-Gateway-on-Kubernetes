import { useId, useState, type RefObject } from 'react';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Dialog, DialogClose } from '../../components/ui/Dialog';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { toast } from '../../components/ui/Toast';
import { ApiError, errorMessage } from '../../lib/api';
import { createServer, patchServer, useInvalidateServers, type ServerView } from './api';
import {
  buildCreateBody,
  buildPatchBody,
  initialFormValues,
  issuesToErrors,
  needsNewCredential,
  validateServerForm,
  type AuthType,
  type FormErrors,
  type ServerFormValues,
} from './serverForm';

export interface ServerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The server to edit; omit it to add one. */
  server?: ServerView;
  returnFocusTo?: RefObject<HTMLElement | null>;
}

const AUTH_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'bearer', label: 'Bearer token' },
  { value: 'header', label: 'Custom header' },
];

const SSRF_HINT = 'In-cluster servers must be listed in the chart setting gateway.internalUpstreams.';

/** Maps an API failure onto the field it is about; whatever has no field becomes the form-level message. */
function apiErrorToFormErrors(err: unknown): FormErrors {
  if (err instanceof ApiError) {
    if (err.code === 'SSRF_REJECTED') return { url: `${err.message} ${SSRF_HINT}` };
    if (err.code === 'CONFLICT') return { slug: err.message };
    if (err.code === 'VALIDATION_FAILED') return issuesToErrors(err.details, err.message);
  }
  return { form: errorMessage(err) };
}

/** Add a server, or edit one. Credentials live only in this component's state and the request body. */
export function ServerFormDialog({ open, onOpenChange, server, returnFocusTo }: ServerFormDialogProps) {
  const editing = server !== undefined;
  const formId = useId();
  const invalidate = useInvalidateServers();
  const [values, setValues] = useState<ServerFormValues>(() => initialFormValues(server));
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  // A fresh form each time the dialog opens (and never a credential left over from last time). Done
  // during render, only on the open transition: a background refetch of `server` must not wipe typing.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    // On open: a fresh form. On close: drop what was typed, so a credential never lingers in state.
    setValues(initialFormValues(server));
    setErrors({});
    setSubmitting(false);
  }

  const set = <K extends keyof ServerFormValues>(key: K, value: ServerFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined, form: undefined }));
  };

  const showCredential = values.authType !== 'none';
  const credentialRequired = needsNewCredential(values, server);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const found = validateServerForm(values, server);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setSubmitting(true);
    try {
      if (server) await patchServer(server.id, buildPatchBody(values));
      else await createServer(buildCreateBody(values));
      await invalidate();
      toast.success(editing ? 'Server updated' : 'Server added');
      setValues((v) => ({ ...v, credential: '' }));
      onOpenChange(false);
    } catch (err) {
      setErrors(apiErrorToFormErrors(err));
    } finally {
      setSubmitting(false);
    }
  };

  const strip = (e: FormErrors): FormErrors => Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined));
  const err = strip(errors);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      {...(returnFocusTo && { returnFocusTo })}
      title={editing ? `Edit ${server.name}` : 'Add server'}
      description={editing ? 'Change how the gateway connects to this MCP server.' : 'Register an MCP server. Its tools appear under the slug as a prefix.'}
      footer={
        <>
          <DialogClose asChild>
            <Button disabled={submitting}>Cancel</Button>
          </DialogClose>
          <Button type="submit" form={formId} variant="primary" loading={submitting}>
            {editing ? 'Save changes' : 'Add server'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
        {err.form ? (
          <p role="alert" className="rounded-control bg-danger-subtle px-3 py-2 text-sm text-danger">
            {err.form}
          </p>
        ) : null}
        {!editing && (
          <FormField label="Slug" required error={err.slug} hint="Lowercase letters, digits and hyphens; cannot be changed later.">
            <Input value={values.slug} onChange={(e) => set('slug', e.target.value)} autoComplete="off" spellCheck={false} maxLength={16} />
          </FormField>
        )}
        <FormField label="Name" required error={err.name}>
          <Input value={values.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" maxLength={100} />
        </FormField>
        <FormField label="URL" required error={err.url} hint="The MCP endpoint, starting with http:// or https://.">
          <Input type="url" value={values.url} onChange={(e) => set('url', e.target.value)} autoComplete="off" spellCheck={false} />
        </FormField>
        <FormField label="Authentication" error={err.authType}>
          <Select options={AUTH_OPTIONS} value={values.authType} onChange={(e) => set('authType', e.target.value as AuthType)} />
        </FormField>
        {values.authType === 'header' && (
          <FormField label="Header name" required error={err.authHeaderName} hint="For example X-Api-Key.">
            <Input value={values.authHeaderName} onChange={(e) => set('authHeaderName', e.target.value)} autoComplete="off" spellCheck={false} />
          </FormField>
        )}
        {showCredential && (
          <FormField
            label="Credential"
            required={credentialRequired}
            error={err.credential}
            hint={
              editing && server.hasCredential
                ? 'Leave blank to keep the current credential.'
                : 'Stored encrypted; it is never shown again.'
            }
          >
            <Input
              type="password"
              value={values.credential}
              onChange={(e) => set('credential', e.target.value)}
              autoComplete="new-password"
              spellCheck={false}
              disabled={values.clearCredential}
            />
          </FormField>
        )}
        {editing && server.hasCredential && showCredential && (
          <Checkbox
            label="Remove stored credential"
            checked={values.clearCredential}
            onChange={(e) => {
              set('clearCredential', e.target.checked);
              if (e.target.checked) set('credential', '');
            }}
          />
        )}
        {editing && (
          <Checkbox
            label="Enabled"
            description="A disabled server is not connected and its tools are not offered to clients."
            checked={values.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
          />
        )}
      </form>
    </Dialog>
  );
}
