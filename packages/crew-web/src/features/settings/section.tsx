// Khung một mục trang (tiêu đề + nội dung) dùng chung cho các trang Skills, Máy, Docs, Cài đặt.
// Ghi chú cho gói ds: nên có widget Section; hiện dựng từ Card vì feature chỉ được dùng class bố cục.
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/ds';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">{children}</CardContent>
      </Card>
    </section>
  );
}
