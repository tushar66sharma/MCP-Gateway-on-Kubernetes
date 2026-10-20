import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const base =
  'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium ' +
  'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-55 [&_svg]:size-4 [&_svg]:shrink-0';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover disabled:hover:bg-accent',
  secondary:
    'border border-border-strong bg-surface text-fg hover:bg-surface-hover hover:border-border-input disabled:hover:bg-surface',
  ghost: 'text-fg-muted hover:bg-surface-hover hover:text-fg disabled:hover:bg-transparent',
  danger: 'bg-danger-solid text-danger-solid-fg hover:bg-danger-solid-hover disabled:hover:bg-danger-solid',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[0.8125rem]',
  md: 'h-10 px-4 text-sm',
};

const iconOnlySizes: Record<ButtonSize, string> = { sm: 'size-8', md: 'size-10' };

/** The button look, for links that act as buttons (`<Link className={buttonClasses('primary')}>`). */
export function buttonClasses(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string): string {
  return clsx(base, variants[variant], sizes[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, sets `aria-busy` and disables the button; the label stays, so the name is stable. */
  loading?: boolean;
  /** A leading icon. With no children the button is icon-only and needs an `aria-label`. */
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  disabled,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  const iconOnly = children === undefined || children === null || children === false;
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(base, variants[variant], iconOnly ? iconOnlySizes[size] : sizes[size], className)}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : icon}
      {children}
    </button>
  );
}
