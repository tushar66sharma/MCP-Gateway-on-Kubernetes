import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Select, type SelectOption } from '../../components/ui/Select';
import { useMe } from '../../lib/auth';
import { useServers } from '../servers/api';
import { useUsers } from '../team/api';
import { EMPTY_FILTERS, hasFilters, OUTCOMES, type AuditFilterValues } from './api';

export interface AuditFiltersProps {
  value: AuditFilterValues;
  onChange: (next: AuditFilterValues) => void;
}

const OUTCOME_OPTIONS: SelectOption[] = OUTCOMES.map((o) => ({ value: o, label: o.charAt(0).toUpperCase() + o.slice(1) }));

/** Adds the current value as an option when the list does not (yet) contain it, so the select can show it. */
function withCurrent(options: SelectOption[], current: string): SelectOption[] {
  return current !== '' && !options.some((o) => o.value === current) ? [...options, { value: current, label: current }] : options;
}

/** Only mounted for admins: members never request the user list. */
function UserFilter({ value, onChange }: AuditFiltersProps) {
  const users = useUsers();
  const options = (users.data ?? []).map((u) => ({ value: u.id, label: u.email }));
  return (
    <FormField label="User">
      <Select
        placeholder="All users"
        options={withCurrent(options, value.userId)}
        value={value.userId}
        onChange={(e) => onChange({ ...value, userId: e.target.value })}
      />
    </FormField>
  );
}

/** The audit filter bar. Controlled: the page keeps the values in the URL's search params. */
export function AuditFilters({ value, onChange }: AuditFiltersProps) {
  const { me } = useMe();
  const servers = useServers();
  // The tool name is committed on Enter or blur, so typing does not refetch on every keystroke.
  const [toolDraft, setToolDraft] = useState(value.toolName);
  const [seenTool, setSeenTool] = useState(value.toolName);
  if (seenTool !== value.toolName) {
    // The URL changed under the field (Clear filters, back button): show it.
    setSeenTool(value.toolName);
    setToolDraft(value.toolName);
  }

  const commitTool = () => {
    const next = toolDraft.trim();
    if (next !== value.toolName) onChange({ ...value, toolName: next });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    commitTool();
  };

  const serverOptions = withCurrent(
    (servers.data ?? []).map((s) => ({ value: s.slug, label: `${s.name} (${s.slug})` })),
    value.serverSlug,
  );

  return (
    <form onSubmit={submit} aria-label="Filter the audit log" className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 sm:p-5">
      {me?.role === 'admin' ? <UserFilter value={value} onChange={onChange} /> : null}
      <FormField label="Server">
        <Select
          placeholder="All servers"
          options={serverOptions}
          value={value.serverSlug}
          onChange={(e) => onChange({ ...value, serverSlug: e.target.value })}
        />
      </FormField>
      <FormField label="Tool name">
        <Input
          value={toolDraft}
          maxLength={200}
          placeholder="e.g. create_product"
          onChange={(e) => setToolDraft(e.target.value)}
          onBlur={commitTool}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitTool();
            }
          }}
        />
      </FormField>
      <FormField label="Outcome">
        <Select
          placeholder="Any outcome"
          options={OUTCOME_OPTIONS}
          value={value.outcome}
          onChange={(e) => onChange({ ...value, outcome: e.target.value as AuditFilterValues['outcome'] })}
        />
      </FormField>
      <FormField label="From">
        <Input type="datetime-local" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} />
      </FormField>
      <FormField label="To">
        <Input type="datetime-local" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} />
      </FormField>
      {hasFilters(value) ? (
        <div className="sm:col-span-2 lg:col-span-3">
          <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
            Clear filters
          </Button>
        </div>
      ) : null}
    </form>
  );
}
