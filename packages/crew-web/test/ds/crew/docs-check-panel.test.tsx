// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DocsCheckResult } from '@/api/crew/types';
import { DocsCheckPanel } from '@/ds';
import { initI18n, setLanguage } from '@/i18n';
import fixtures from './__fixtures__/docs-check.json';

beforeAll(async () => {
  await initI18n();
});
afterEach(async () => {
  cleanup();
  await setLanguage('vi');
});

describe('DocsCheckPanel', () => {
  it('exit 0: Đạt, kèm commit, range, tác giả, giờ Hồ Chí Minh', () => {
    render(<DocsCheckPanel result={fixtures.ok as DocsCheckResult} />);
    expect(screen.getByText('Đạt')).toBeTruthy();
    expect(screen.getByText(/6e7268d3a1b2/)).toBeTruthy();
    expect(screen.getByText(/3ec54bf\.\.6e7268d/)).toBeTruthy();
    expect(screen.getByText(/integrator/)).toBeTruthy();
    expect(screen.getByText(/10\/10\/2026 11:20/)).toBeTruthy();
  });
  it('exit khác 0: Lỗi kèm mã, tác giả thiếu hiện Không rõ', () => {
    render(<DocsCheckPanel result={fixtures.fail as DocsCheckResult} />);
    expect(screen.getByText('Lỗi (exit 2)')).toBeTruthy();
    expect(screen.getByText(/Không rõ/)).toBeTruthy();
  });
  it('bằng chứng không hợp lệ', () => {
    render(<DocsCheckPanel result={fixtures.invalid as DocsCheckResult} />);
    expect(screen.getByText('Bằng chứng không hợp lệ')).toBeTruthy();
    expect(screen.queryByText(/Range/)).toBeNull();
  });
  it('chưa có kết quả', () => {
    render(<DocsCheckPanel result={null} />);
    expect(screen.getByText('Chưa có kết quả kiểm docs')).toBeTruthy();
  });
});
