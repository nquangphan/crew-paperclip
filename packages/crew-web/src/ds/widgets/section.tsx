// crew: tự dựng
import type * as React from 'react';
import { cn } from '../cn';
import { Card, CardContent, CardHeader, CardTitle } from '../components/card';

/** Tiêu đề một nhóm trên trang (cấp 2), dùng khi nhóm không cần khung thẻ. */
function SectionHeading({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 data-slot="section-heading" className={cn('text-base font-semibold', className)} {...props} />;
}

/** Một mục trang: khung thẻ có tiêu đề nhóm và nội dung xếp dọc. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section data-slot="section" aria-label={title}>
      <Card>
        <CardHeader>
          <CardTitle>
            <SectionHeading>{title}</SectionHeading>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">{children}</CardContent>
      </Card>
    </section>
  );
}

export { Section, SectionHeading };
