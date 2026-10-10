// clone: ui/src/components/ActivityCharts.tsx @ v2026.1005.0
import type * as React from 'react';

interface BarSegmentData {
  color: string;
  flex: number;
}
interface BarData {
  key: string;
  label: string | null;
  title: string;
  heightPct: number;
  segments: BarSegmentData[];
}
interface LegendItem {
  color: string;
  label: string;
}

/** Khung một biểu đồ: tiêu đề nhỏ, chú thích thời gian, nội dung. */
function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div data-slot="chart-card" className="space-y-3 rounded-lg border border-border p-4">
      <div>
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        {subtitle ? <span className="text-(length:--text-nano) text-muted-foreground/60">{subtitle}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** Biểu đồ cột 14 ngày; mỗi cột xếp chồng các đoạn màu theo tỉ lệ. Không có dữ liệu thì hiện `emptyText`. */
function BarChart({ bars, legend, emptyText }: { bars: BarData[]; legend?: LegendItem[]; emptyText: string }) {
  if (bars.every((b) => b.segments.length === 0)) return <p className="text-xs text-muted-foreground">{emptyText}</p>;
  return (
    <div data-slot="bar-chart">
      <div className="flex h-20 items-end gap-(--sz-3px)">
        {bars.map((b) => (
          <div key={b.key} className="flex h-full flex-1 flex-col justify-end" title={b.title}>
            {b.segments.length > 0 ? (
              <div
                className="flex flex-col-reverse gap-px overflow-hidden"
                style={{ height: `${b.heightPct}%`, minHeight: 2 }}
              >
                {b.segments.map((s) => (
                  <div key={s.color} style={{ flex: s.flex, backgroundColor: s.color }} />
                ))}
              </div>
            ) : (
              <div className="rounded-sm bg-muted/30" style={{ height: 2 }} />
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-(--sz-3px)">
        {bars.map((b) => (
          <div key={b.key} className="flex-1 text-center">
            {b.label ? (
              <span className="text-(length:--text-nano) tabular-nums text-muted-foreground">{b.label}</span>
            ) : null}
          </div>
        ))}
      </div>
      {legend && legend.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-x-2.5 gap-y-0.5">
          {legend.map((item) => (
            <span key={item.label} className="flex items-center gap-1 text-(length:--text-nano) text-muted-foreground">
              <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export type { BarData, BarSegmentData, LegendItem };
export { BarChart, ChartCard };
