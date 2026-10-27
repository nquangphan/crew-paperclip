// crew: tự dựng
import type * as React from 'react';
import { cn } from '../cn';

/** Dòng lỗi nhỏ đặt ngay dưới ô nhập sai (trong bảng hoặc hàng), không kèm nhãn. */
function InlineError({ className, ...props }: React.ComponentProps<'p'>) {
  return <p data-slot="inline-error" role="alert" className={cn('text-xs text-destructive', className)} {...props} />;
}

export { InlineError };
