// Định dạng ngày giờ theo Asia/Ho_Chi_Minh cho hai ngôn ngữ giao diện.
export type Lang = 'vi' | 'en';

const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const EMPTY = '—';

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function toDate(iso: string | Date | null | undefined): Date | null {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** vi: `10/10/2026 00:31`, en: `10/10/2026, 00:31`. */
export function formatDateTime(iso: string | Date | null | undefined, lang: Lang): string {
  const d = toDate(iso);
  if (!d) return EMPTY;
  const p = Object.fromEntries(parts.formatToParts(d).map((x) => [x.type, x.value]));
  const date = `${p.day}/${p.month}/${p.year}`;
  const time = `${p.hour}:${p.minute}`;
  return lang === 'en' ? `${date}, ${time}` : `${date} ${time}`;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86400],
  ['month', 30 * 86400],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

/** "5 phút trước" / "5 minutes ago" / "in 30 seconds". */
export function formatRelative(iso: string | Date | null | undefined, lang: Lang, now: Date = new Date()): string {
  const d = toDate(iso);
  if (!d) return EMPTY;
  const diffSec = Math.round((d.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'always' });
  for (const [unit, size] of UNITS) {
    if (abs >= size || unit === 'second') return rtf.format(Math.trunc(diffSec / size), unit);
  }
  return EMPTY;
}
