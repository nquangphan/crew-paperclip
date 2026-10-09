// crew: tự dựng
import type * as React from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Đường dẫn breadcrumb phía trên tiêu đề (ví dụ `<Breadcrumb/>`). */
  breadcrumb?: React.ReactNode;
  actions?: React.ReactNode;
}

function PageHeader({ title, description, breadcrumb, actions }: PageHeaderProps) {
  return (
    <header data-slot="page-header" className="flex flex-col gap-2 pb-4">
      {breadcrumb}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export type { PageHeaderProps };
export { PageHeader };
