import { describe, expect, it } from 'vitest';
import { PasteTooLargeError, preparePaste } from '@/features/terminal/paste';

const KiB = 1024;
const MiB = 1024 * KiB;

describe('preparePaste', () => {
  it('nhiều dòng thì bọc bracketed paste trong một khúc', () => {
    const chunks = preparePaste('a\nb');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].startsWith('\x1b[200~')).toBe(true);
    expect(chunks[0].endsWith('\x1b[201~')).toBe(true);
  });

  it('một dòng thì gửi nguyên, không bọc', () => {
    expect(preparePaste('ls -la')).toEqual(['ls -la']);
  });

  it('40 KiB một dòng chia 3 khúc 16 KiB, không bọc', () => {
    const text = 'x'.repeat(40 * KiB);
    const chunks = preparePaste(text);
    expect(chunks.map((c) => c.length)).toEqual([16 * KiB, 16 * KiB, 8 * KiB]);
    expect(chunks.join('')).toBe(text);
    expect(chunks[0].startsWith('\x1b[200~')).toBe(false);
  });

  it('không cắt giữa cặp surrogate UTF-16', () => {
    const text = `${'x'.repeat(16 * KiB - 1)}😀tail`;
    const chunks = preparePaste(text);
    expect(chunks[0]).toHaveLength(16 * KiB - 1);
    expect(chunks[1].startsWith('😀')).toBe(true);
    expect(chunks.join('')).toBe(text);
  });

  it('hơn 16 MiB thì ném PasteTooLargeError', () => {
    expect(() => preparePaste('x'.repeat(17 * MiB))).toThrow(PasteTooLargeError);
  });
});
