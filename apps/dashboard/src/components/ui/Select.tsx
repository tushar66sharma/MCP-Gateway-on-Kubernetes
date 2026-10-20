import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';
import type { Ref, SelectHTMLAttributes } from 'react';
import { useFormField } from './FormField';
import { controlBorder, controlClasses } from './Input';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: SelectOption[];
  /** A first, empty choice such as "All servers". */
  placeholder?: string;
  invalid?: boolean;
  ref?: Ref<HTMLSelectElement>;
}

/**
 * A native `<select>`, styled. Native keeps full keyboard and screen-reader support and the platform
 * picker on phones, which a custom listbox would have to rebuild.
 */
export function Select({ options, placeholder, invalid, className, id, required, ...rest }: SelectProps) {
  const field = useFormField();
  const isInvalid = invalid ?? field?.invalid ?? false;
  return (
    <div className={clsx('relative', className)}>
      <select
        id={id ?? field?.id}
        required={required ?? field?.required}
        aria-invalid={isInvalid || undefined}
        aria-describedby={rest['aria-describedby'] ?? field?.describedBy}
        className={clsx(controlClasses, controlBorder(isInvalid), 'h-10 appearance-none pl-3 pr-9')}
        {...rest}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-subtle" />
    </div>
  );
}
