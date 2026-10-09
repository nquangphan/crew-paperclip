// crew: tự dựng
import * as React from 'react';
import { cn } from '../cn';

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}

function Field({ label, hint, error, htmlFor, className, children }: FieldProps) {
  const reactId = React.useId();
  const hintId = hint ? `${reactId}-hint` : undefined;
  const errorId = error ? `${reactId}-error` : undefined;
  return (
    <div data-slot="field" data-invalid={error ? 'true' : undefined} className={cn('grid gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium leading-none">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export type { FieldProps };
export { Field };
