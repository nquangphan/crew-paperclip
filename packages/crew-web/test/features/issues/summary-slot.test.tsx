// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    const card = (await screen.findByText('Thêm trang đăng nhập')).closest('button');
    expect(card?.getAttribute('aria-label')).toMatch(/^CRE-37: Thêm trang đăng nhập/);
    expect(screen.getByRole('region', { name: 'Bản đồ yêu cầu Crew' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Kiểm docs' })).toBeTruthy();
    expect(screen.getByText(/integrator/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng map' }));
    expect(screen.queryByRole('region', { name: 'Kiểm docs' })).toBeNull();
  });

  it('yêu cầu gốc có nhãn docs: map ghi loại Viết tài liệu cho việc con, đọc nhãn từ issue gốc', async () => {
    const s = mockServer({
      [`POST ${DATA}/crew.map`]: { body: { data: map } },
      [`POST ${DATA}/crew.docsCheck`]: { body: { data: docs.ok } },
      'GET /api/issues/i-root': { body: { ...ISSUE, id: 'i-root', labels: [{ id: 'l-docs', name: 'docs' }] } },
    });
    mountAt(CHILD);
    fireEvent.click(await screen.findByRole('button', { name: 'Mở map' }));
    await waitFor(() => {
      const card = screen.getByText('Thêm trang đăng nhập').closest('button');
      expect(card?.getAttribute('aria-label')).toMatch(/Viết tài liệu/);
    });
    expect(s.calls.some((c) => c.method === 'GET' && c.url.endsWith('/api/issues/i-root'))).toBe(true);
  });

  it('yêu cầu gốc có nhãn plan: map ghi loại Lập kế hoạch cho việc con', async () => {
    mockServer({
      [`POST ${DATA}/crew.map`]: { body: { data: map } },
      [`POST ${DATA}/crew.docsCheck`]: { body: { data: docs.ok } },
      'GET /api/issues/i-root': { body: { ...ISSUE, id: 'i-root', labels: [{ id: 'l-plan', name: 'plan' }] } },
    });
    mountAt(CHILD);
    fireEvent.click(await screen.findByRole('button', { name: 'Mở map' }));
    await waitFor(() => {
      const card = screen.getByText('Thêm trang đăng nhập').closest('button');
      expect(card?.getAttribute('aria-label')).toMatch(/Lập kế hoạch/);
    });
  });

  it('bấm ô trong map điều hướng tới issue đó', async () => {
    mockServer({
      [`POST ${DATA}/crew.map`]: { body: { data: map } },
      [`POST ${DATA}/crew.docsCheck`]: { body: { data: null } },
    });
    mountAt(CHILD);
    fireEvent.click(await screen.findByRole('button', { name: 'Mở map' }));
    fireEvent.click(await screen.findByText('Thêm trang đăng nhập'));
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

  it('ticket tổng code-bf: dải bốn giai đoạn và khối Bug Finding đọc route của plugin', async () => {
    const stage = { currentStageId: 's1', currentType: 'review', completed: ['s0'], position: 1 };
    const root = { ...map.root, kind: 'code-bf', stage };
    const head = `3f9c1e07a2b4${'0'.repeat(28)}`;
    const s = mockServer({
      [`POST ${DATA}/crew.map`]: {
        body: { data: { ...map, root, nodes: map.nodes.map((n) => (n.id === root.id ? root : n)) } },
      },
      [`POST ${DATA}/crew.docsCheck`]: { body: { data: null } },
      'GET /api/plugins/crew.core/api/issues/i-root/bug-finding': {
        body: {
          runs: [
            {
              id: 'r2',
              companyId: 'c1',
              issueId: 'i-root',
              approvalRound: 0,
              run: 2,
              requestId: 'q2',
              machineJobId: null,
              machineId: 'm1',
              headSha: head,
              prUrl: 'https://github.com/o/r/pull/87',
              state: 'running',
              verdict: null,
              lanesDone: 4,
              lanesTotal: 7,
              findings: null,
              feedbackText: null,
              reportDocumentKey: null,
              costUsd: null,
              error: null,
              createdAt: '2026-11-04T03:00:00.000Z',
              startedAt: '2026-11-04T03:01:00.000Z',
              finishedAt: null,
              triage: null,
            },
          ],
          batchesUsed: 1,
          maxBatches: 2,
          currentHead: head,
          approvalRound: 0,
        },
      },
    });
    mountAt({ ...ISSUE, id: 'i-root', identifier: 'CRE-36', parentId: null });
    const strip = await screen.findByRole('list', { name: 'Giai đoạn' });
    expect(await screen.findByText('4/7 lane xong')).toBeTruthy();
    expect(
      within(strip)
        .getAllByRole('listitem')
        .map((step) => step.textContent),
    ).toEqual([
      '1. Gộp code + PRPR #87',
      '2. Review Bug FindingLượt 2 / tối đa 3 · Đang chạy',
      '3. Owner duyệtChờ',
      '4. MergeIntegrator merge PR sau khi duyệt',
    ]);
    expect(s.calls.some((c) => c.url === '/api/plugins/crew.core/api/issues/i-root/bug-finding?companyId=c1')).toBe(
      true,
    );
  });

  it('việc con của ticket tổng code-bf không hiện khối Bug Finding', async () => {
    const root = {
      ...map.root,
      kind: 'code-bf',
      stage: { currentStageId: 's1', currentType: 'review', completed: [], position: 1 },
    };
    const s = mockServer({
      [`POST ${DATA}/crew.map`]: { body: { data: { ...map, root } } },
      [`POST ${DATA}/crew.docsCheck`]: { body: { data: null } },
    });
    mountAt(CHILD);
    expect(await screen.findByText(/con xong/)).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Giai đoạn' })).toBeNull();
    expect(s.calls.some((c) => c.url.includes('/bug-finding'))).toBe(false);
  });
});
