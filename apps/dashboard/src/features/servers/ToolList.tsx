import { Search } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Input } from '../../components/ui/Input';
import { plural } from '../../lib/format';
import type { ServerView } from './api';

/** The name clients see: `<slug>__<tool>`, unless the gateway already prefixed it. */
export function prefixedName(slug: string, name: string): string {
  return name.startsWith(`${slug}__`) ? name : `${slug}__${name}`;
}

export function ToolList({ server }: { server: Pick<ServerView, 'slug' | 'tools'> }) {
  const [query, setQuery] = useState('');
  const listId = useId();
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return server.tools.filter((t) => q === '' || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
  }, [server.tools, query]);

  if (server.tools.length === 0) {
    return <p className="text-sm text-fg-muted">No tools yet. They appear once the server is connected.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="relative max-w-sm">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
        <Input
          type="search"
          aria-label="Filter tools"
          aria-controls={listId}
          placeholder="Filter tools"
          className="pl-9"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <p className="text-[0.8125rem] text-fg-muted" role="status">
        {query.trim() === '' ? plural(server.tools.length, 'tool') : `${shown.length} of ${plural(server.tools.length, 'tool')}`}
      </p>
      {shown.length === 0 ? (
        <p className="text-sm text-fg-muted">No tools match “{query.trim()}”.</p>
      ) : (
        <ul id={listId} className="divide-y divide-border rounded-control border border-border">
          {shown.map((t) => (
            <li key={t.name} className="px-4 py-3">
              <code className="font-mono text-[0.8125rem] font-medium break-all text-fg">{prefixedName(server.slug, t.name)}</code>
              {t.description ? <p className="mt-1 text-sm text-fg-muted">{t.description}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
