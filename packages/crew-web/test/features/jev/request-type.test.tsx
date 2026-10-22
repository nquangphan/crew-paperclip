// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import { NewRequestDialog } from '@/features/issues/new/new-request-dialog';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';

vi.mock('@/features/readiness', () => ({
  useProjectReadiness: () => ({
    isLoading: false,
    data: [{ projectId: 'p1', state: 'ready', failed: [], agents: [] }],
  }),
}));

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  URL.createObjectURL = () => 'blob:preview';
  URL.revokeObjectURL = () => {};
});
afterEach(cleanup);

const COMPANY = { id: 'c1', name: '2P', issuePrefix: 'TPS' };
const JUDGE = '/api/crew/companies/c1/jev/judge/request-type';
const OUTCOME = '/api/crew/companies/c1/jev/judgments/9/outcome';

const routes = (judge: unknown) =>
  ({
    'GET /api/companies/c1/projects': { body: [{ id: 'p1', name: 'Alpha', archivedAt: null }] },
    'GET /api/companies/c1/agents': { body: [{ id: 'a-assist', name: 'Trợ Lý Alpha' }] },
    'GET /api/plugins/crew.core/api/projects/p1/roles': {
      body: {
        roles: { assistantAgentId: 'a-assist', executorAgentIds: [], reviewerAgentId: 'r', integratorAgentId: 'i' },
      },
    },
    'GET /api/companies/c1/labels': { body: [{ id: 'l-research', name: 'research' }] },
    'POST /api/companies/c1/issues': { status: 201, body: { id: 'i-new', identifier: 'TPS-5' } },
    [`POST ${OUTCOME}`]: { body: { ok: true } },
    [`POST ${JUDGE}`]: judge,
  }) as Parameters<typeof mockServer>[0];

function mount() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
        <NewRequestDialog open onOpenChange={vi.fn()} companyId="c1" />
      </CompanyContext.Provider>
    </QueryClientProvider>,
  );
}

const judgeCalls = (s: ReturnType<typeof mockServer>) => s.calls.filter((c) => c.url === JUDGE);
const reply = (over: Record<string, unknown> = {}) => ({
  body: { ok: true, mode: 'on', label: 'research', confidence: 0.88, judgmentId: '9', ...over },
});

async function fill(title: string, description = '') {
  await screen.findByRole('combobox', { name: 'Project' });
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Project' }), { key: 'Enter' });
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Alpha' }));
  fireEvent.change(screen.getByLabelText('Tiêu đề'), { target: { value: title } });
  if (description) fireEvent.change(screen.getByLabelText('Mô tả'), { target: { value: description } });
  await screen.findByText('Trợ Lý Alpha');
}

describe('Jev gợi ý loại yêu cầu', () => {
  it('chế độ on: sau 800 ms hiện chip, không tự đổi loại; bấm chip mới chọn; gửi ghi loại cuối', async () => {
    const s = mockServer(routes(reply()));
    mount();
    await fill('So sánh hai thư viện biểu đồ cho báo cáo');
    expect(judgeCalls(s)).toHaveLength(0);
    const chip = await screen.findByTestId('jev-kind-chip', undefined, { timeout: 4000 });
    expect(chip.textContent).toBe('Jev gợi ý: Nghiên cứu');
    expect(judgeCalls(s)).toHaveLength(1);
    expect(judgeCalls(s)[0].body).toEqual({
      title: 'So sánh hai thư viện biểu đồ cho báo cáo',
      description: '',
      current: 'code',
    });
    // Loại vẫn là Code cho tới khi owner bấm chip.
    expect(screen.getByRole('combobox', { name: 'Loại' }).textContent).toBe('Code');
    fireEvent.click(chip);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Loại' }).textContent).toBe('Nghiên cứu'));
    expect(screen.queryByTestId('jev-kind-chip')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    await waitFor(() => expect(s.calls.some((c) => c.url === OUTCOME)).toBe(true));
    expect(s.calls.find((c) => c.url === OUTCOME)?.body).toEqual({ outcome: 'research' });
  });

  it('dưới 20 ký tự không gọi Jev; gõ liên tiếp chỉ gọi một lần sau khi ngừng', async () => {
    const s = mockServer(routes(reply()));
    mount();
    await fill('Ngắn thôi');
    await new Promise((r) => setTimeout(r, 1000));
    expect(judgeCalls(s)).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Tiêu đề'), { target: { value: 'Tiêu đề đã đủ dài để hỏi' } });
    await new Promise((r) => setTimeout(r, 300));
    fireEvent.change(screen.getByLabelText('Tiêu đề'), { target: { value: 'Tiêu đề đã đủ dài để hỏi Jev' } });
    await screen.findByTestId('jev-kind-chip', undefined, { timeout: 4000 });
    expect(judgeCalls(s)).toHaveLength(1);
  });

  it.each([
    ['shadow', reply({ mode: 'shadow', label: null, judgmentId: null })],
    ['ok:false', { body: { ok: false, reason: 'unsure' } }],
    ['HTTP 500', { status: 500, body: { error: 'x' } }],
    ['sai dạng', { body: { ok: true, mode: 'on', label: 'thơ' } }],
  ])('%s: không hiện gì và tạo yêu cầu như cũ', async (_name, judge) => {
    const s = mockServer(routes(judge));
    mount();
    await fill('So sánh hai thư viện biểu đồ cho báo cáo');
    await waitFor(() => expect(judgeCalls(s)).toHaveLength(1), { timeout: 4000 });
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByTestId('jev-kind-chip')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    await waitFor(() =>
      expect(s.calls.filter((c) => c.url.endsWith('/issues') && c.method === 'POST')).toHaveLength(1),
    );
    expect(s.calls.some((c) => c.url === OUTCOME)).toBe(false);
  });

  it('Jev gợi ý đúng loại đang chọn thì không hiện chip', async () => {
    const s = mockServer(routes(reply({ label: 'code' })));
    mount();
    await fill('Thêm nút xuất báo cáo vào trang tổng quan');
    await waitFor(() => expect(judgeCalls(s)).toHaveLength(1), { timeout: 4000 });
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByTestId('jev-kind-chip')).toBeNull();
  });
});
