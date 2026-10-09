// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SummarySlot } from '@/features/issues/detail/crew/summary-slot';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import docs from '../../ds/crew/__fixtures__/docs-check.json';
import map from '../../ds/crew/__fixtures__/map.json';
import { ISSUE, wrap } from './detail-fixtures';

// xyflow đo node bằng ResizeObserver và DOMMatrixReadOnly, jsdom không có.
beforeAll(async () => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  class DOMMatrixStub {
    m22 = 1;
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('DOMMatrixReadOnly', DOMMatrixStub);
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

// Issue đang xem là con CRE-38 (i-b) của yêu cầu gốc CRE-36 (i-root) trong fixture map.
const CHILD = { ...ISSUE, id: 'i-b', identifier: 'CRE-38' };
const DATA = '/api/plugins/crew.core/data';

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function mountAt(issue: unknown) {
  const router = createMemoryRouter(
    [
      {
        path: '/:companyPrefix/issues/:ref',
        element: wrap(
          <>
            <SummarySlot issue={issue as never} />
            <Where />
          </>,
        ),
      },
    ],
    { initialEntries: ['/TPS/issues/CRE-38'] },
  );
  return render(<RouterProvider router={router} />);
}

describe('SummarySlot (S6.1–S6.3)', () => {
  it('hiện dòng "x/y con xong · giai đoạn · docs", docsCheck hỏi theo yêu cầu gốc', async () => {
    const s = mockServer({
      [`POST ${DATA}/crew.map`]: { body: { data: map } },
      [`POST ${DATA}/crew.docsCheck`]: { body: { data: docs.ok } },
    });
    mountAt(CHILD);
    expect(await screen.findByText(/1\/4 con xong · Reviewer · docs Đạt/)).toBeTruthy();
    const mapCall = s.calls.find((c) => c.url.endsWith('/crew.map'));
    expect(mapCall?.body).toEqual({ companyId: 'c1', params: { companyId: 'c1', issueId: 'i-b' } });
    await waitFor(() => {
      const docsCall = s.calls.find((c) => c.url.endsWith('/crew.docsCheck'));
      expect(docsCall?.body).toEqual({ companyId: 'c1', params: { companyId: 'c1', issueId: 'i-root' } });
    });
  });

  it('Mở map hiện bản đồ và panel kiểm docs; Đóng map ẩn đi', async () => {
    mockServer({
      [`POST ${DATA}/crew.map`]: { body: { data: map } },
      [`POST ${DATA}/crew.docsCheck`]: { body: { data: docs.ok } },
    });
    mountAt(CHILD);
    fireEvent.click(await screen.findByRole('button', { name: 'Mở map' }));
    expect(await screen.findByText(/CRE-37 · Thêm trang đăng nhập/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Kiểm docs' })).toBeTruthy();
    expect(screen.getByText(/integrator/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng map' }));
    expect(screen.queryByRole('region', { name: 'Kiểm docs' })).toBeNull();
  });

  it('bấm ô trong map điều hướng tới issue đó', async () => {
    mockServer({
      [`POST ${DATA}/crew.map`]: { body: { data: map } },
      [`POST ${DATA}/crew.docsCheck`]: { body: { data: null } },
    });
    mountAt(CHILD);
    fireEvent.click(await screen.findByRole('button', { name: 'Mở map' }));
    fireEvent.click(await screen.findByText(/CRE-37 · Thêm trang đăng nhập/));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/TPS/issues/CRE-37'));
  });

  it('issue không thuộc yêu cầu Crew thì không render gì', async () => {
    const s = mockServer({
      [`POST ${DATA}/crew.map`]: {
        body: { data: { root: map.root, nodes: [], edges: [], diagnostics: ['not_crew_root'] } },
      },
    });
    mountAt(CHILD);
    await waitFor(() => expect(s.calls.some((c) => c.url.endsWith('/crew.map'))).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('button', { name: 'Mở map' })).toBeNull();
    expect(s.calls.some((c) => c.url.endsWith('/crew.docsCheck'))).toBe(false);
  });

  it('lỗi tải map hiện nguyên văn', async () => {
    mockServer({ [`POST ${DATA}/crew.map`]: { status: 500, body: { error: 'plugin crew.core chưa sẵn sàng' } } });
    mountAt(CHILD);
    expect(await screen.findByText('plugin crew.core chưa sẵn sàng')).toBeTruthy();
  });
});
