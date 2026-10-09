// crew: tự dựng
import type * as React from 'react';

interface PropertyItem {
  label: string;
  value: React.ReactNode;
}

function PropertyList({ items }: { items: PropertyItem[] }) {
  return (
    <dl data-slot="property-list" className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map((it) => (
        <div key={it.label} className="contents">
          <dt className="text-muted-foreground">{it.label}</dt>
          <dd className="min-w-0 break-words">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export type { PropertyItem };
export { PropertyList };
