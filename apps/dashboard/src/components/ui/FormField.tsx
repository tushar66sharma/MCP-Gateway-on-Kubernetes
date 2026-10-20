import { clsx } from 'clsx';
import { createContext, useContext, useId, type ReactNode } from 'react';

interface FieldContext {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

const FormFieldContext = createContext<FieldContext | null>(null);

/** Input, Select and Textarea read their id, `aria-describedby` and `aria-invalid` from the field around them. */
export function useFormField(): FieldContext | null {
  return useContext(FormFieldContext);
}

export interface FormFieldProps {
  label: ReactNode;
  /** Short help shown under the control. */
  hint?: ReactNode;
  /** Inline validation message; marks the control invalid and is announced with it. */
  error?: ReactNode;
  required?: boolean;
  /** Use your own id (for example to point a `<label>` elsewhere at it). */
  id?: string;
  className?: string;
  /** Extra content on the label row (a "Show password" toggle, a "Generate" link). */
  labelAction?: ReactNode;
  children: ReactNode;
}

export function FormField({ label, hint, error, required = false, id, className, labelAction, children }: FormFieldProps) {
  const generated = useId();
  const fieldId = id ?? `field-${generated}`;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <FormFieldContext.Provider value={{ id: fieldId, describedBy, invalid: Boolean(error), required }}>
      <div className={clsx('flex flex-col gap-1.5', className)}>
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={fieldId} className="text-[0.8125rem] font-medium text-fg">
            {label}
            {required && (
              <span className="ml-0.5 text-danger" aria-hidden>
                *
              </span>
            )}
          </label>
          {labelAction}
        </div>
        {children}
        {error ? (
          <p id={errorId} className="text-[0.8125rem] text-danger">
            {error}
          </p>
        ) : null}
        {hint ? (
          <p id={hintId} className="text-[0.8125rem] text-fg-subtle">
            {hint}
          </p>
        ) : null}
      </div>
    </FormFieldContext.Provider>
  );
}
