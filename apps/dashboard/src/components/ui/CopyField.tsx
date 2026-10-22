import { clsx } from 'clsx';
import { Check, Copy } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from './Button';
import { toast } from './Toast';

export interface CopyFieldProps {
  label: string;
  value: string;
  /** Multi-line values (a JSON config) render in a scrollable code block instead of a one-line field. */
  multiline?: boolean;
  className?: string;
}

function selectContents(el: HTMLElement | null): void {
  if (!el) return;
  if (el instanceof HTMLInputElement) {
    el.select();
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** A read-only value with a copy button: API keys, invite links, client configs. */
export function CopyField({ label, value, multiline = false, className }: CopyFieldProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const valueRef = useRef<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // No Clipboard API (plain http on a non-localhost host): select the text for a manual copy.
      selectContents(valueRef.current);
      toast.error('Copy isn’t available here. The text is selected; press Ctrl+C to copy it.');
    }
  };

  const setRef = (el: HTMLElement | null) => {
    valueRef.current = el;
  };

  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <div className="flex items-center justify-between gap-3">
        <span id={labelId} className="text-[0.8125rem] font-medium text-fg">
          {label}
        </span>
        <Button
          size="sm"
          variant="ghost"
          icon={copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
          onClick={() => void copy()}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {multiline ? (
        <pre
          ref={setRef}
          role="region"
          aria-labelledby={labelId}
          tabIndex={0}
          className="max-h-64 overflow-auto rounded-control border border-border bg-surface-sunken p-3 font-mono text-xs leading-relaxed whitespace-pre text-fg"
        >
          {value}
        </pre>
      ) : (
        <input
          ref={setRef}
          readOnly
          value={value}
          aria-labelledby={labelId}
          onFocus={(e) => e.currentTarget.select()}
          spellCheck={false}
          className="h-10 w-full rounded-control border border-border bg-surface-sunken px-3 font-mono text-[0.8125rem] text-fg"
        />
      )}
      <span className="sr-only" aria-live="polite">
        {copied ? `${label} copied` : ''}
      </span>
    </div>
  );
}
