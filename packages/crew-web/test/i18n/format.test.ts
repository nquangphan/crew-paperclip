import { describe, expect, it } from 'vitest';
import { formatDateTime, formatRelative } from '@/i18n/format';

describe('format', () => {
  it('formatDateTime theo múi giờ Asia/Ho_Chi_Minh', () => {
    expect(formatDateTime('2026-10-09T17:31:26Z', 'vi')).toBe('10/10/2026 00:31');
    expect(formatDateTime('2026-10-09T17:31:26Z', 'en')).toBe('10/10/2026, 00:31');
  });
  it('iso rỗng hoặc sai trả dấu gạch', () => {
    expect(formatDateTime('', 'vi')).toBe('—');
    expect(formatDateTime('không phải ngày', 'en')).toBe('—');
  });
  it('formatRelative theo ngôn ngữ', () => {
    const now = new Date('2026-10-10T00:00:00Z');
    expect(formatRelative('2026-10-09T23:55:00Z', 'vi', now)).toBe('5 phút trước');
    expect(formatRelative('2026-10-09T23:55:00Z', 'en', now)).toBe('5 minutes ago');
    expect(formatRelative('2026-10-10T00:00:30Z', 'en', now)).toBe('in 30 seconds');
    expect(formatRelative('2026-10-08T00:00:00Z', 'vi', now)).toBe('2 ngày trước');
  });
});
