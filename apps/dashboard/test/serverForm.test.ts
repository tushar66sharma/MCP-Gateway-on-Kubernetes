import { describe, expect, it } from 'vitest';
import { originChanged, validateServerForm, type ServerFormValues } from '../src/features/servers/serverForm';

const base: ServerFormValues = {
  slug: 'notes',
  name: 'Notes',
  url: 'https://notes.example.com/mcp',
  authType: 'none',
  authHeaderName: '',
  credential: '',
  clearCredential: false,
  enabled: true,
};
const original = { url: 'https://notes.example.com/mcp', hasCredential: true };

describe('originChanged', () => {
  it('compares scheme, host and port, not the path', () => {
    expect(originChanged('https://a.example.com/mcp', 'https://a.example.com/v2/mcp')).toBe(false);
    expect(originChanged('https://a.example.com/mcp', 'https://b.example.com/mcp')).toBe(true);
    expect(originChanged('http://a.example.com/mcp', 'https://a.example.com/mcp')).toBe(true);
    expect(originChanged('https://a.example.com:8443/mcp', 'https://a.example.com/mcp')).toBe(true);
  });
});

describe('validateServerForm', () => {
  it('origin change requires credential', () => {
    const values = { ...base, authType: 'bearer' as const, url: 'https://other.example.com/mcp' };
    expect(validateServerForm(values, original).credential).toMatch(/new credential/i);
    expect(validateServerForm({ ...values, credential: 'new-secret' }, original).credential).toBeUndefined();
    expect(validateServerForm({ ...values, clearCredential: true }, original).credential).toBeUndefined();
  });

  it('path-only change keeps credential', () => {
    const values = { ...base, authType: 'bearer' as const, url: 'https://notes.example.com/v2/mcp' };
    expect(validateServerForm(values, original)).toEqual({});
  });

  it('header auth needs header name', () => {
    expect(validateServerForm({ ...base, authType: 'header' })).toHaveProperty('authHeaderName');
    expect(validateServerForm({ ...base, authType: 'header', authHeaderName: 'bad name' })).toHaveProperty('authHeaderName');
    expect(validateServerForm({ ...base, authType: 'header', authHeaderName: 'X-Api-Key' })).toEqual({});
  });

  it('slug pattern', () => {
    expect(validateServerForm({ ...base, slug: 'Notes' })).toHaveProperty('slug');
    expect(validateServerForm({ ...base, slug: 'a' })).toHaveProperty('slug');
    expect(validateServerForm({ ...base, slug: '1abc' })).toHaveProperty('slug');
    expect(validateServerForm({ ...base, slug: 'my-notes' })).toEqual({});
  });

  it('checks name and url scheme', () => {
    expect(validateServerForm({ ...base, name: '  ' })).toHaveProperty('name');
    expect(validateServerForm({ ...base, url: 'ftp://x.example.com' })).toHaveProperty('url');
    expect(validateServerForm({ ...base, url: 'notaurl' })).toHaveProperty('url');
  });
});
