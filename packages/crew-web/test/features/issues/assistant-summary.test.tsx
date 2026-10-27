// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { IssuePage } from '@/features/issues/detail/issue-page';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { AGENTS, ISSUE, mount, PROJECTS } from './detail-fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const DESCRIPTION =
  'Làm trang đăng nhập\n\n## Tổng kết của Trợ Lý\n\n### Kết quả\nĐã xong phần ĐÃ-XONG\n\n### Hình ảnh\n![ảnh](/api/attachments/att1/content)';

function server(description: string | null) {
  return mockServer({
    'GET /api/issues/TPS-2': { body: { ...ISSUE, description } },
    'GET /api/issues/i1/comments': { body: [] },
    'GET /api/issues/i1/attachments': { body: [] },
    'GET /api/issues/i1/documents': { body: [] },
    'GET /api/issues/i1/runs': { body: [] },
    'GET /api/issues/i1/live-runs': { body: [] },
    'POST /api/issues/i1/read': { body: { id: 'i1', lastReadAt: '2026-10-10T03:00:00.000Z' } },
    'PATCH /api/issues/i1': { body: { ...ISSUE, description } },
    'GET /api/companies/c1/agents': { body: AGENTS },
    'GET /api/companies/c1/projects': { body: PROJECTS },
    'GET /api/companies/c1/issues': { body: [] },
  } as Parameters<typeof mockServer>[0]);
}

describe('mục Tổng kết của Trợ Lý trên trang yêu cầu', () => {
  it('mô tả không lặp tổng kết, khối riêng hiện sau mô tả kèm ảnh', async () => {
    server(DESCRIPTION);
    mount(<IssuePage />);
    const summary = await screen.findByTestId('assistant-summary');
    const desc = screen.getByTestId('issue-description');
    expect(desc.textContent).toContain('Làm trang đăng nhập');
    expect(desc.textContent).not.toContain('ĐÃ-XONG');
    expect(desc.textContent).not.toContain('Tổng kết của Trợ Lý');
    expect(summary.textContent).toContain('Tổng kết của Trợ Lý');
    expect(summary.textContent).toContain('ĐÃ-XONG');
    expect(desc.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(summary.querySelector('img')?.getAttribute('src')).toBe('/api/attachments/att1/content');
  });

  it('không có tổng kết thì không render khối', async () => {
    server('Chỉ có mô tả');
    mount(<IssuePage />);
    await screen.findByTestId('issue-description');
    expect(screen.queryByTestId('assistant-summary')).toBeNull();
  });

  it('body rỗng mà có tổng kết thì mô tả hiện chữ trống', async () => {
    server('## Tổng kết của Trợ Lý\nx');
    mount(<IssuePage />);
    await screen.findByTestId('assistant-summary');
    expect(screen.getByTestId('issue-description').textContent).toContain('Chưa có mô tả');
  });

  it('sửa mô tả vẫn ra nguyên chuỗi gồm cả tổng kết', async () => {
    const s = server(DESCRIPTION);
    mount(<IssuePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa mô tả' }));
    const box = screen.getByRole('textbox', { name: 'Mô tả' }) as HTMLTextAreaElement;
    expect(box.value).toBe(DESCRIPTION);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/issues/i1'))).toBe(true));
    const call = s.calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/issues/i1'));
    expect(JSON.stringify(call?.body)).toContain('Tổng kết của Trợ Lý');
  });
});
