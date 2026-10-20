import { clsx } from 'clsx';
import type { InputHTMLAttributes, ReactNode, Ref } from 'react';
import { useFormField } from './FormField';

/** Shared look of text-like controls (Input, Select, Textarea). */
export const controlClasses =
  'w-full rounded-control border bg-surface text-sm text-fg placeholder:text-fg-subtle transition-colors ' +
  'hover:border-fg-subtle focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-muted read-only:bg-surface-sunken';

export function controlBorder(invalid: boolean): string {
  return invalid ? 'border-danger focus-visible:outline-danger' : 'border-border-input';
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** Content inside the right edge of the field, such as a "Show password" button. */
  trailing?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ invalid, trailing, className, id, required, ...rest }: InputProps) {
  const field = useFormField();
  const isInvalid = invalid ?? field?.invalid ?? false;
  const input = (
    <input
      id={id ?? field?.id}
      required={required ?? field?.required}
      aria-invalid={isInvalid || undefined}
      aria-describedby={rest['aria-describedby'] ?? field?.describedBy}
      className={clsx(controlClasses, controlBorder(isInvalid), 'h-10 px-3', trailing ? 'pr-11' : undefined, className)}
      {...rest}
    />
  );
  if (!trailing) return input;
  return (
    <div className="relative">
      {input}
      <div className="absolute inset-y-0 right-0 flex items-center pr-1">{trailing}</div>
    </div>
  );
}
