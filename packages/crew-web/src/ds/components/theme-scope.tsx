// crew: tự dựng
import type * as React from 'react';
import { cn } from '../cn';

/** Bọc một vùng ở theme sáng hoặc tối (class `dark`), dùng cho trang /ds và ảnh chụp. */
function ThemeScope({
  theme,
  className,
  children,
}: {
  theme: 'light' | 'dark';
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="theme-scope"
      data-theme={theme}
      className={cn(theme === 'dark' && 'dark', 'rounded-lg border bg-background p-4 text-foreground', className)}
    >
      {children}
    </div>
  );
}

export { ThemeScope };
