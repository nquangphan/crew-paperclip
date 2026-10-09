// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CrewMap, CrewRoot, DocsCheckResult } from '@/api/crew/types';
import { CrewSummary, crewSummaryLine } from '@/ds';
import { initI18n, setLanguage } from '@/i18n';
import docs from './__fixtures__/docs-check.json';
import mapFixture from './__fixtures__/map.json';
import rootsFixture from './__fixtures__/roots.json';

const map = mapFixture as unknown as CrewMap;
const roots = rootsFixture as unknown as CrewRoot[];

beforeAll(async () => {
  await initI18n();
});
afterEach(async () => {
  cleanup();
  await setLanguage('vi');
});

// t giả trả khóa kèm tham số để kiểm khóa truyền xuống.
const echo = (key: string, options?: Record<string, unknown>) => key + JSON.stringify(options ?? {});

describe('CrewSummary', () => {
  it('map: số con xong, giai đoạn, kết quả docs', () => {
    render(<CrewSummary map={map} issueId="i-b" docsCheck={docs.ok as DocsCheckResult} onToggleMap={() => {}} />);
    expect(screen.getByText(/1\/4 con xong/)).toBeTruthy();
    expect(screen.getByText(/Reviewer/)).toBeTruthy();
    expect(screen.getByText(/docs Đạt/)).toBeTruthy();
  });
  it('nút mở/đóng map gọi onToggleMap và đổi nhãn theo expanded', () => {
    const toggle = vi.fn();
    const { rerender } = render(<CrewSummary map={map} issueId="i-root" docsCheck={null} onToggleMap={toggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở map' }));
    expect(toggle).toHaveBeenCalledTimes(1);
    rerender(<CrewSummary map={map} issueId="i-root" docsCheck={null} expanded onToggleMap={toggle} />);
    expect(screen.getByRole('button', { name: 'Đóng map' }).getAttribute('aria-expanded')).toBe('true');
  });
  it('docs: chưa có / không hợp lệ / lỗi', () => {
    expect(crewSummaryLine(map, 'i-root', null, echo)).toContain('crewSummary.docs.none');
    expect(crewSummaryLine(map, 'i-root', docs.invalid as DocsCheckResult, echo)).toContain('crewSummary.docs.invalid');
    expect(crewSummaryLine(map, 'i-root', docs.fail as DocsCheckResult, echo)).toContain('crewSummary.docs.fail');
  });
  it('roots: mỗi yêu cầu gốc một dòng với tiến độ con', () => {
    render(<CrewSummary roots={roots} docsCheck={null} onToggleMap={() => {}} />);
    expect(screen.getByText(/CRE-36/)).toBeTruthy();
    expect(screen.getByText('1/4')).toBeTruthy();
    expect(screen.getByText(/CRE-50/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('roots rỗng', () => {
    render(<CrewSummary roots={[]} docsCheck={null} onToggleMap={() => {}} />);
    expect(screen.getByText('Chưa có yêu cầu Crew nào')).toBeTruthy();
  });
});
