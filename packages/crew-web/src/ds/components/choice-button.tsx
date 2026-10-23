// crew: tự dựng
import * as React from 'react';
import { cn } from '../cn';
import { Button } from './button';

/**
 * Nút một lựa chọn của câu hỏi (thẻ hỏi owner): nhãn dài xuống dòng trong nút, căn trái, không tràn khỏi khung.
 * Đang chọn thì nền đậm (`aria-pressed`).
 */
const ChoiceButton = React.forwardRef<
  HTMLButtonElement,
  Omit<React.ComponentProps<typeof Button>, 'variant' | 'size'> & { selected?: boolean }
>(function ChoiceButton({ className, selected = false, ...props }, ref) {
  return (
    <Button
      ref={ref}
      type="button"
      size="sm"
      variant={selected ? 'default' : 'outline'}
      aria-pressed={selected}
      data-slot="choice-button"
      className={cn('h-auto min-h-9 max-w-full justify-start py-2 text-left whitespace-normal break-words', className)}
      {...props}
    />
  );
});

/** Câu hỏi đứng đầu một nhóm lựa chọn: giữ xuống dòng của câu, chữ dài không đẩy khung rộng ra. */
function ChoiceLegend({ className, ...props }: React.ComponentProps<'legend'>) {
  return <legend data-slot="choice-legend" className={cn('whitespace-pre-wrap break-words', className)} {...props} />;
}

export { ChoiceButton, ChoiceLegend };
