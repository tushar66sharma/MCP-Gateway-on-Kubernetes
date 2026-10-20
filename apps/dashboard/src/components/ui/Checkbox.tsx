import { clsx } from 'clsx';
import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

/** A native checkbox with its own label (and optional description), so it is never unlabelled. */
export function Checkbox({ label, description, id, className, disabled, ...rest }: CheckboxProps) {
  const generated = useId();
  const inputId = id ?? `checkbox-${generated}`;
  const descriptionId = description ? `${inputId}-description` : undefined;
  return (
    <div className={clsx('flex items-start gap-3', className)}>
      <input
        id={inputId}
        type="checkbox"
        disabled={disabled}
        aria-describedby={descriptionId}
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded-[4px] border-border-input accent-accent disabled:cursor-not-allowed"
        {...rest}
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={inputId} className={clsx('text-sm font-medium text-fg', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="text-[0.8125rem] text-fg-subtle">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
