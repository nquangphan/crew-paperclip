// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ContributionPopupHost } from '@/features/contributions';
import { ContributionActions } from '@/features/contributions/contribution-actions';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { contribution, DIRECTORY } from '../contributions/fixtures';
import { wrap } from '../issues/detail-fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

const JUDGE = '/api/crew/companies/c1/jev/judge/request-type';
const ITEM = contribution({
  id: 'k1',
  kind: 'issue',
  projectId: 'p1',
  targetIssueId: null,
  title: 'So sánh hai thư viện biểu đồ',
  body: 'Cần biết thư viện nào nhẹ hơn cho trang báo cáo',
});

function server(judge: unknown) {
  return mockServer({
    'GET /api/companies/c1/projects': { body: [{ id: 'p1', name: 'Alpha', archivedAt: null }] },
    'GET /api/companies/c1/agents': { body: [{ id: 'a-assistant', name: 'Trợ Lý Alpha' }] },
    'GET /api/companies/c1/labels': { body: [{ id: 'l-research', name: 'research' }] },
    'GET /api/companies/c1/user-directory': { body: DIRECTORY },
    'GET /api/plugins/crew.core/api/projects/p1/roles': {
      body: {
        roles: { assistantAgentId: 'a-assistant', executorAgentIds: [], reviewerAgentId: 'r', integratorAgentId: 'i' },
      },
    },
    [`POST ${JUDGE}`]: judge,
  } as Parameters<typeof mockServer>[0]);
}

async function open() {
  render(
    wrap(
      <MemoryRouter>
        <ContributionActions contribution={ITEM} />
        <ContributionPopupHost />
      </MemoryRouter>,
    ),
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Duyệt: So sánh hai thư viện biểu đồ' }));
  await screen.findByRole('dialog');
}

describe('dialog duyệt góp ý: Jev gợi ý loại', () => {
  it('chế độ on: hiện chip từ tiêu đề + nội dung góp ý, loại chưa đổi cho tới khi bấm', async () => {
    const s = server({ body: { ok: true, mode: 'on', label: 'research', confidence: 0.9, judgmentId: '3' } });
    await open();
    const chip = await screen.findByTestId('jev-kind-chip', undefined, { timeout: 4000 });
    expect(chip.textContent).toBe('Jev gợi ý: Nghiên cứu');
    expect(s.calls.find((c) => c.url === JUDGE)?.body).toEqual({
      title: 'So sánh hai thư viện biểu đồ',
      description: 'Cần biết thư viện nào nhẹ hơn cho trang báo cáo',
      current: 'code',
    });
    expect(screen.getByRole('combobox', { name: 'Loại' }).textContent).toContain('Code');
    fireEvent.click(chip);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Loại' }).textContent).toContain('Nghiên cứu'));
  });

  it('lỗi 500: không có chip, dialog dùng bình thường', async () => {
    const s = server({ status: 500, body: { error: 'x' } });
    await open();
    await waitFor(() => expect(s.calls.some((c) => c.url === JUDGE)).toBe(true), { timeout: 4000 });
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByTestId('jev-kind-chip')).toBeNull();
    expect(screen.getByRole('button', { name: 'Duyệt' })).toBeTruthy();
  });
});
