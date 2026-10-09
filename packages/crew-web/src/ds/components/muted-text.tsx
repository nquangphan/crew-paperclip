// crew: tự dựng
import type * as React from 'react';
import { cn } from '../cn';

/** Chữ phụ (mô tả, ghi chú) theo token muted-foreground. */
function MutedText({ className, ...props }: React.ComponentProps<'p'>) {
  return <p data-slot="muted-text" className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export { MutedText };
