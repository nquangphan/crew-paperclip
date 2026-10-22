// crew: tự dựng
// Huy hiệu Jev trên thẻ việc của bản đồ Roadmap: khiên + số, màu theo mức cần chú ý (đỏ: có lệnh bị chặn thật; vàng: có
// deny chỉ ghi log hoặc ca không chắc; xám: chỉ lệnh cho qua), kèm chấm nhỏ khi có ca lệch C3. Chỉ là hình trong thẻ (thẻ là
// một nút bấm, không lồng nút khác); tooltip và nhãn đọc màn hình có đủ số. Không dùng tím (đang làm) hay xanh ngọc (đang duyệt).
import { ShieldCheck } from 'lucide-react';
import { useT } from '@/i18n';
import type { RoadmapJev } from './roadmap-types';

type TFn = ReturnType<typeof useT>['t'];

export type JevBadgeTone = 'blocked' | 'attention' | 'quiet';

/** Mức của huy hiệu theo số liệu; thẻ chỉ có ca lệch C3 (không có lệnh nào) tính là `quiet`. */
export function jevBadgeTone(jev: RoadmapJev): JevBadgeTone {
  if (jev.appliedDeny > 0) return 'blocked';
  if (jev.deny > 0 || jev.escalate > 0) return 'attention';
  return 'quiet';
}

/** Chữ ngắn trên huy hiệu: số lệnh bị chặn / cần xem / đã qua; thẻ chỉ có ca lệch thì không có chữ. */
export function jevBadgeText(t: TFn, jev: RoadmapJev): string | null {
  const tone = jevBadgeTone(jev);
  if (tone === 'blocked') return t('roadmap.jev.blocked', { count: jev.appliedDeny });
  if (tone === 'attention') return t('roadmap.jev.attention', { count: jev.deny + jev.escalate });
  return jev.calls > 0 ? t('roadmap.jev.calls', { count: jev.calls }) : null;
}

/** Đủ số liệu cho tooltip và trình đọc màn hình. */
export function jevSummaryText(t: TFn, jev: RoadmapJev): string {
  const parts = [
    t('roadmap.jev.tip.calls', { count: jev.calls }),
    t('roadmap.jev.tip.blocked', { count: jev.appliedDeny }),
    t('roadmap.jev.tip.logOnly', { count: Math.max(0, jev.deny - jev.appliedDeny) }),
    t('roadmap.jev.tip.escalate', { count: jev.escalate }),
    t('roadmap.jev.tip.error', { count: jev.error }),
  ];
  if (jev.mismatch > 0) parts.push(t('roadmap.jev.tip.mismatch', { count: jev.mismatch }));
  return `${t('roadmap.jev.name')}: ${parts.join(' · ')}`;
}

const TONE_COLOR: Record<JevBadgeTone, string> = {
  blocked: 'var(--roadmap-tone-blocked)',
  attention: 'var(--roadmap-tone-todo)',
  quiet: 'var(--muted-foreground)',
};

export function RoadmapJevBadge({ jev }: { jev: RoadmapJev }) {
  const { t } = useT();
  const tone = jevBadgeTone(jev);
  const color = TONE_COLOR[tone];
  const text = jevBadgeText(t, jev);
  return (
    <span
      data-slot="roadmap-jev"
      data-tone={tone}
      title={jevSummaryText(t, jev)}
      className="inline-flex h-4 shrink-0 items-center gap-0.5 rounded-full border px-1 text-[10px] leading-4 font-medium whitespace-nowrap"
      style={{ color, borderColor: `color-mix(in oklab, ${color} 45%, transparent)` }}
    >
      <ShieldCheck aria-hidden className="size-3" />
      {text}
      {jev.mismatch > 0 ? (
        <span
          aria-hidden
          data-slot="roadmap-jev-mismatch"
          className="size-1.5 rounded-full"
          style={{ background: 'var(--roadmap-tone-todo)' }}
        />
      ) : null}
    </span>
  );
}
