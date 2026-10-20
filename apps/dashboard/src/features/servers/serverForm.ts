import type { ServerView } from './api';

export type AuthType = ServerView['authType'];

export interface ServerFormValues {
  slug: string;
  name: string;
  url: string;
  authType: AuthType;
  authHeaderName: string;
  credential: string;
  /** Edit only: remove the stored credential. */
  clearCredential: boolean;
  enabled: boolean;
}

/** What the form needs to know about the server being edited. */
export type OriginalServer = Pick<ServerView, 'url' | 'hasCredential'>;

export type FormErrors = Partial<Record<keyof ServerFormValues | 'form', string>>;

export const SLUG_PATTERN = /^[a-z][a-z0-9-]{1,15}$/;
const HEADER_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const RESERVED_HEADERS = new Set(['host', 'content-length', 'content-type', 'authorization', 'cookie', 'connection', 'transfer-encoding']);

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** True when scheme, host or port differ (the gateway's rule). An unparsable old URL counts as changed. */
export function originChanged(oldUrl: string, newUrl: string): boolean {
  const next = parse(newUrl);
  if (!next) return false;
  const prev = parse(oldUrl);
  return prev === null || prev.origin !== next.origin;
}

export function initialFormValues(server?: ServerView): ServerFormValues {
  return {
    slug: server?.slug ?? '',
    name: server?.name ?? '',
    url: server?.url ?? '',
    authType: server?.authType ?? 'none',
    authHeaderName: server?.authHeaderName ?? '',
    credential: '',
    clearCredential: false,
    enabled: server?.enabled ?? true,
  };
}

/** True when the stored credential would be sent to a new origin unless the admin acts. */
export function needsNewCredential(values: ServerFormValues, original?: OriginalServer): boolean {
  return Boolean(
    original?.hasCredential &&
      values.authType !== 'none' &&
      !values.clearCredential &&
      values.credential === '' &&
      originChanged(original.url, values.url.trim()),
  );
}

/** Inline validation: field to message. An empty object means the form can be submitted. */
export function validateServerForm(values: ServerFormValues, original?: OriginalServer): FormErrors {
  const errors: FormErrors = {};
  if (original === undefined && !SLUG_PATTERN.test(values.slug)) {
    errors.slug = 'Use 2-16 characters: lowercase letters, digits or hyphens, starting with a letter.';
  }
  const name = values.name.trim();
  if (name.length < 1 || name.length > 100) errors.name = 'Enter a name of 1 to 100 characters.';

  const url = values.url.trim();
  const parsed = parse(url);
  if (url === '' || url.length > 2048) errors.url = 'Enter the server URL.';
  else if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) errors.url = 'The URL must start with http:// or https://.';

  if (values.authType === 'header') {
    const h = values.authHeaderName;
    if (!h) errors.authHeaderName = 'Enter the header that carries the credential.';
    else if (!HEADER_PATTERN.test(h)) errors.authHeaderName = 'Use 1-64 letters, digits or hyphens.';
    else if (RESERVED_HEADERS.has(h.toLowerCase())) errors.authHeaderName = 'This header name is reserved.';
  }
  if (values.credential !== '' && !/^[\x20-\x7e]*$/.test(values.credential)) errors.credential = 'Use printable ASCII characters only.';
  else if (values.credential.length > 4096) errors.credential = 'The credential is too long.';
  else if (needsNewCredential(values, original)) {
    errors.credential = 'The URL points to a different host, so enter a new credential, or tick “Remove stored credential”.';
  }
  return errors;
}

export interface CreateServerBody {
  slug: string;
  name: string;
  url: string;
  authType: AuthType;
  authHeaderName?: string;
  credential?: string;
}

export function buildCreateBody(values: ServerFormValues): CreateServerBody {
  const body: CreateServerBody = { slug: values.slug, name: values.name.trim(), url: values.url.trim(), authType: values.authType };
  if (values.authType === 'header') body.authHeaderName = values.authHeaderName;
  if (values.authType !== 'none' && values.credential !== '') body.credential = values.credential;
  return body;
}

export interface PatchServerBody {
  name: string;
  url: string;
  enabled: boolean;
  authType: AuthType;
  authHeaderName?: string;
  credential?: string;
  clearCredential?: true;
}

/** A blank credential is left out (the server keeps the stored one); "remove" sends `clearCredential`. */
export function buildPatchBody(values: ServerFormValues): PatchServerBody {
  const body: PatchServerBody = {
    name: values.name.trim(),
    url: values.url.trim(),
    enabled: values.enabled,
    authType: values.authType,
  };
  if (values.authType === 'header') body.authHeaderName = values.authHeaderName;
  if (values.authType !== 'none') {
    if (values.clearCredential) body.clearCredential = true;
    else if (values.credential !== '') body.credential = values.credential;
  }
  return body;
}

const FIELDS: ReadonlySet<string> = new Set(['slug', 'name', 'url', 'authType', 'authHeaderName', 'credential', 'enabled']);

/** Maps `details.issues[{path, message}]` of a VALIDATION_FAILED onto fields; anything else is form-level. */
export function issuesToErrors(details: Record<string, unknown> | undefined, fallback: string): FormErrors {
  const errors: FormErrors = {};
  const issues = details?.issues;
  if (Array.isArray(issues)) {
    for (const issue of issues) {
      if (typeof issue !== 'object' || issue === null) continue;
      const { path, message } = issue as { path?: unknown; message?: unknown };
      if (typeof message !== 'string') continue;
      const key = typeof path === 'string' && FIELDS.has(path) ? (path as keyof ServerFormValues) : 'form';
      const text = key === 'form' && typeof path === 'string' && path !== '' ? `${path} ${message}` : message;
      errors[key] = errors[key] ? `${errors[key]} ${text}` : text;
    }
  }
  if (Object.keys(errors).length === 0) errors.form = fallback;
  return errors;
}
