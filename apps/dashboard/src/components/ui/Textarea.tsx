import { clsx } from 'clsx';
import type { Ref, TextareaHTMLAttributes } from 'react';
import { useFormField } from './FormField';
import { controlBorder, controlClasses } from './Input';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ invalid, className, id, required, rows = 4, ...rest }: TextareaProps) {
  const field = useFormField();
  const isInvalid = invalid ?? field?.invalid ?? false;
  return (
    <textarea
      id={id ?? field?.id}
      required={required ?? field?.required}
      rows={rows}
      aria-invalid={isInvalid || undefined}
      aria-describedby={rest['aria-describedby'] ?? field?.describedBy}
      className={clsx(controlClasses, controlBorder(isInvalid), 'resize-y px-3 py-2 leading-relaxed', className)}
      {...rest}
    />
  );
}
