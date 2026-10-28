// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ModelSettings, ModelSettingsView, ModelUpgradeResult } from '@/api';
import { CompanyContext, MeContext } from '@/app/hooks';
import { ModelSettingsPage } from '@/features/settings/models/model-settings-page';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { SETTINGS } from '../../lib/instructions/__fixtures__/model-settings';
import { COMPANY } from '../agents/helpers';

beforeAll(async () => {
  await initI18n();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(async () => {
  cleanup();
  await setLanguage('vi');
});

const ME = { id: 'u1', name: 'Đại Ca', email: 'owner@example.com', image: null };
const OWNER_VIEW: ModelSettingsView = {
  revision: 3,
  updatedAt: '2026-10-27T03:30:00.000Z',
  updatedByUserId: 'u1',
  settings: SETTINGS,
  canEdit: true,
};
const GET = 'GET /api/crew/model-settings';
const PUT = 'PUT /api/crew/model-settings';
const UPGRADE = 'POST /api/crew/model-settings/upgrade';

const change = (agentId: string, name: string, from: string, to: string) => ({
  agentId,
  companyId: COMPANY.id,
  name,
  role: 'executor' as const,
  from: { model: from, effort: null },
  to: { model: to, effort: null },
});
const saved = (settings: ModelSettings, over: Record<string, unknown> = {}) => ({
  revision: 4,
  settings,
  applied: { agents: [], skipped: [] },
  dryRun: false,
  ...over,
});

type Routes = Parameters<typeof mockServer>[0];

function mount(view: ModelSettingsView = OWNER_VIEW, extra: Routes = {}) {
  const server = mockServer({ [GET]: { body: view }, ...extra });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/', element: <ModelSettingsPage /> },
      { path: '/other', element: <div>trang khác</div> },
    ],
    { initialEntries: ['/'] },
  );
  render(
    <QueryClientProvider client={client}>
      <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
        <MeContext.Provider value={ME}>
          <RouterProvider router={router} />
        </MeContext.Provider>
      </CompanyContext.Provider>
    </QueryClientProvider>,
  );
  return { server, router };
}

const puts = (s: ReturnType<typeof mockServer>) =>
  s.calls.filter((c) => c.method === 'PUT') as {
    body: { baseRevision: number; settings: ModelSettings; dryRun?: boolean };
  }[];

async function pick(name: string, option: string) {
  fireEvent.keyDown(await screen.findByRole('combobox', { name }), { key: 'Enter' });
  fireEvent.click(screen.getByRole('option', { name: option }));
}

function addModelTo(runtime: string, id: string) {
  fireEvent.change(screen.getByLabelText(`Id model mới của ${runtime}`), { target: { value: id } });
  fireEvent.click(
    within(screen.getByLabelText(`Id model mới của ${runtime}`).closest('form') as HTMLElement).getByRole('button', {
      name: 'Thêm model',
    }),
  );
}

describe('ModelSettingsPage', () => {
  it('hiện bốn phần từ bảng của server, kèm bản và người lưu', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Cài đặt model' })).toBeTruthy();
    expect(screen.getByText(/Bản r3, lưu lúc 27\/10\/2026 10:30 bởi Đại Ca/)).toBeTruthy();
    for (const title of ['Danh sách model', 'Bảng độ khó', 'Model mặc định từng vai', 'Nâng model hàng loạt']) {
      expect(screen.getByRole('region', { name: title })).toBeTruthy();
    }
    const catalog = screen.getByRole('region', { name: 'Danh sách model' });
    expect(within(catalog).getByText('opencode-go/kimi-k3')).toBeTruthy();
    expect(within(catalog).getByText('gpt-6-sol')).toBeTruthy();
    expect(
      (within(catalog).getByRole('checkbox', { name: 'Xem ảnh: claude-opus-5-5' }) as HTMLElement).getAttribute(
        'aria-checked',
      ),
    ).toBe('true');
    expect(
      (within(catalog).getByRole('checkbox', { name: 'Xem ảnh: opencode-go/kimi-k3' }) as HTMLElement).getAttribute(
        'aria-checked',
      ),
    ).toBe('false');
    const table = screen.getByRole('region', { name: 'Bảng độ khó' });
    expect(within(table).getByRole('combobox', { name: 'Model của claude_local ở mức large' }).textContent).toBe(
      'claude-opus-5-5',
    );
    expect(within(table).queryByRole('combobox', { name: 'Effort của opencode_local ở mức small' })).toBeNull();
    const roles = screen.getByRole('region', { name: 'Model mặc định từng vai' });
    expect(within(roles).getAllByRole('row')).toHaveLength(11);
    expect(within(roles).getByText('Override khi reviewer Claude duyệt issue gốc.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('bản chưa ai lưu ghi bản mặc định', async () => {
    mount({ ...OWNER_VIEW, revision: 0, updatedAt: null, updatedByUserId: null });
    expect(await screen.findByText('Bản mặc định, chưa ai lưu')).toBeTruthy();
  });

  it('không phải owner thì chỉ thấy ErrorState, không có ô sửa', async () => {
    mount({ ...OWNER_VIEW, canEdit: false });
    expect(await screen.findByText('Chỉ owner sửa được')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Danh sách model' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lưu' })).toBeNull();
  });

  it('tải lỗi thì có nút Thử lại', async () => {
    const server = mockServer({ [GET]: { status: 500, body: { error: 'hỏng' } } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MeContext.Provider value={ME}>
          <RouterProvider router={createMemoryRouter([{ path: '/', element: <ModelSettingsPage /> }])} />
        </MeContext.Provider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Không tải được cài đặt model')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(server.calls.filter((c) => c.method === 'GET').length).toBeGreaterThan(1));
  });

  it('thêm model, sửa ô bảng độ khó rồi Lưu: dry-run trước, rồi lưu thật đúng body, hiện kết quả', async () => {
    const next = JSON.parse(JSON.stringify(SETTINGS)) as ModelSettings;
    next.catalog.opencode_local.models['e2e-1'] = { vision: false };
    const { server } = mount(OWNER_VIEW, { [PUT]: { body: saved(next) } });
    await screen.findByRole('heading', { name: 'Cài đặt model' });
    addModelTo('opencode_local', 'e2e-1');
    await pick('Model của opencode_local ở mức small', 'e2e-1');
    fireEvent.click(screen.getByRole('button', { name: 'Đưa claude_local lên trước ở mức trivial' }));
    const save = screen.getByRole('button', { name: 'Lưu' });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    expect(await screen.findByText('Đã lưu bản r4 và áp ngay')).toBeTruthy();
    const sent = puts(server).map((c) => c.body);
    expect(sent.map((b) => b.dryRun)).toEqual([true, false]);
    for (const b of sent) {
      expect(b.baseRevision).toBe(3);
      expect(b.settings.catalog.opencode_local.models['e2e-1']).toEqual({ vision: false });
      expect(b.settings.catalog.opencode_local.byComplexity.small).toEqual({ model: 'e2e-1', effort: null });
      expect(b.settings.order.trivial).toEqual(['claude_local', 'opencode_local', 'codex_local']);
    }
    expect(screen.getByText(/Bản r4, lưu lúc/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('đổi mặc định vai có agent bị đổi thì hỏi xác nhận, rồi lưu thật', async () => {
    const next = JSON.parse(JSON.stringify(SETTINGS)) as ModelSettings;
    next.roles.executor = { model: 'claude-opus-5-5', effort: null };
    const dry = saved(next, {
      dryRun: true,
      applied: {
        agents: [
          change('a1', 'executor-1', 'claude-sonnet-5-5', 'claude-opus-5-5'),
          change('a2', 'executor-2', 'claude-sonnet-5-5', 'claude-opus-5-5'),
        ],
        skipped: [{ agentId: 'a3', companyId: COMPANY.id, name: 'executor-hand', role: 'executor', reason: 'manual' }],
      },
    });
    const replies: unknown[] = [dry, { ...dry, dryRun: false }];
    mount(OWNER_VIEW, { [PUT]: () => ({ body: replies.shift() }) });
    await pick('Model của vai executor', 'claude-opus-5-5');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Lưu sẽ đổi model của 2 agent, giữ 1 agent chỉnh tay hoặc bỏ qua.')).toBeTruthy();
    expect(replies).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu và áp' }));
    expect(await screen.findByText('Đã lưu bản r4 và áp ngay')).toBeTruthy();
    expect(replies).toHaveLength(0);
    expect(screen.getByText('Agent đã đổi model: 2')).toBeTruthy();
    expect(screen.getByText('Agent bỏ qua: 1')).toBeTruthy();
  });

  it('422 invalid: viền đỏ đúng ô, tóm tắt lỗi, giữ bản nháp', async () => {
    const issue = { path: 'catalog.opencode_local.byComplexity.small.model', message: 'model không đọc được ảnh' };
    const { server } = mount(OWNER_VIEW, {
      [PUT]: { status: 422, body: { error: 'invalid', code: 'crew_model_settings_invalid', issues: [issue] } },
    });
    await screen.findByRole('heading', { name: 'Cài đặt model' });
    addModelTo('opencode_local', 'e2e-2');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('1 lỗi, sửa các ô viền đỏ rồi lưu lại')).toBeTruthy();
    expect(
      screen.getByRole('combobox', { name: 'Model của opencode_local ở mức small' }).getAttribute('aria-invalid'),
    ).toBe('true');
    expect(
      screen.getByRole('combobox', { name: 'Model của opencode_local ở mức medium' }).getAttribute('aria-invalid'),
    ).toBeNull();
    expect(screen.getAllByText('model không đọc được ảnh').length).toBeGreaterThan(0);
    expect(screen.getByText('e2e-2')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement).disabled).toBe(false);
    expect(puts(server)).toHaveLength(1);
  });

  it('409: banner có nút Tải lại, bấm thì lấy bản mới và bỏ bản nháp', async () => {
    const newer = { ...OWNER_VIEW, revision: 5, updatedByUserId: 'u2' };
    let reads = 0;
    mockServer({
      [GET]: () => ({ body: reads++ === 0 ? OWNER_VIEW : newer }),
      [PUT]: { status: 409, body: { error: 'stale', code: 'crew_model_settings_stale', currentRevision: 5 } },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
          <MeContext.Provider value={ME}>
            <RouterProvider router={createMemoryRouter([{ path: '/', element: <ModelSettingsPage /> }])} />
          </MeContext.Provider>
        </CompanyContext.Provider>
      </QueryClientProvider>,
    );
    await screen.findByRole('heading', { name: 'Cài đặt model' });
    addModelTo('codex_local', 'e2e-3');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Bảng vừa được lưu ở bản r5')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }));
    await waitFor(() => expect(screen.queryByText('Bảng vừa được lưu ở bản r5')).toBeNull());
    expect(screen.getByText(/Bản r5, lưu lúc/)).toBeTruthy();
    expect(screen.queryByText('e2e-3')).toBeNull();
  });

  it('503 và lỗi mạng hiện thông báo, bản nháp còn nguyên', async () => {
    mount(OWNER_VIEW, { [PUT]: { status: 503, body: { error: 'x', code: 'crew_model_settings_unavailable' } } });
    await screen.findByRole('heading', { name: 'Cài đặt model' });
    addModelTo('codex_local', 'e2e-4');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Plugin chưa sẵn sàng, thử lại sau.')).toBeTruthy();
    expect(screen.getByText('e2e-4')).toBeTruthy();
  });

  it('gỡ model còn dùng ở agent: báo tại runtime kèm nút Nâng model điền sẵn model cũ', async () => {
    mount(OWNER_VIEW, {
      [PUT]: {
        status: 422,
        body: {
          error: 'in use',
          code: 'crew_model_in_use',
          inUse: [{ runtime: 'claude_local', model: 'claude-sonnet-5', agents: 3, issues: 1 }],
        },
      },
    });
    await screen.findByRole('heading', { name: 'Cài đặt model' });
    fireEvent.click(screen.getByRole('button', { name: 'Gỡ claude-sonnet-5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('claude-sonnet-5 còn dùng ở 3 agent và 1 issue đang mở.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Nâng model' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Model cũ' }).textContent).toBe('claude-sonnet-5');
    expect(within(dialog).getByText('Thay đổi chưa lưu trên trang sẽ bị bỏ khi nâng.')).toBeTruthy();
  });

  it('model đang dùng ở bảng độ khó hay vai thì nút Gỡ bị khóa', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Cài đặt model' });
    expect((screen.getByRole('button', { name: 'Gỡ claude-sonnet-5-5' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Gỡ gpt-6-sol' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Gỡ claude-sonnet-5' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('mức large khóa ở Claude; không tắt được runtime cuối cùng của một mức', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Cài đặt model' });
    for (const runtime of ['claude_local', 'codex_local', 'opencode_local']) {
      expect((screen.getByRole('switch', { name: `Bật ${runtime} ở mức large` }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    }
    expect((screen.getByRole('switch', { name: 'Bật claude_local ở mức small' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    for (const runtime of ['opencode_local', 'claude_local']) {
      fireEvent.click(screen.getByRole('switch', { name: `Bật ${runtime} ở mức small` }));
    }
    expect((screen.getByRole('switch', { name: 'Bật codex_local ở mức small' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('Hoàn tác trả bản nháp về bản đang lưu', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Cài đặt model' });
    addModelTo('codex_local', 'e2e-5');
    expect(screen.getByText('e2e-5')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }));
    expect(screen.queryByText('e2e-5')).toBeNull();
    expect((screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('id model sai dạng hoặc trùng bị chặn ngay tại ô thêm', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Cài đặt model' });
    addModelTo('codex_local', 'có dấu cách');
    expect(screen.getByText(/Id chỉ gồm chữ, số/)).toBeTruthy();
    addModelTo('codex_local', 'gpt-6-sol');
    expect(screen.getByText('Model đã có trong danh sách.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('rời trang khi còn thay đổi chưa lưu thì hỏi lại', async () => {
    const { router } = mount();
    await screen.findByRole('heading', { name: 'Cài đặt model' });
    addModelTo('codex_local', 'e2e-6');
    await act(async () => {
      void router.navigate('/other');
    });
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Bỏ thay đổi chưa lưu?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    expect(router.state.location.pathname).toBe('/');
    await act(async () => {
      void router.navigate('/other');
    });
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Rời trang' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/other'));
  });

  describe('nâng hàng loạt', () => {
    const upgraded = (over: Partial<ModelUpgradeResult['changes']> = {}, dryRun = true): ModelUpgradeResult => ({
      revision: 4,
      settings: SETTINGS,
      dryRun,
      changes: {
        catalog: 'merged',
        cells: [{ level: 'trivial' }, { level: 'small' }],
        roles: ['executor'],
        agents: [change('a1', 'executor-1', 'claude-sonnet-5', 'claude-sonnet-5-5')],
        skipped: [{ agentId: 'a9', companyId: COMPANY.id, name: 'cho-duyet', role: null, reason: 'pending_approval' }],
        issues: [{ issueId: 'i1', identifier: 'TPS-9', companyId: COMPANY.id }],
        ...over,
      },
    });

    async function openDialog() {
      await screen.findByRole('heading', { name: 'Cài đặt model' });
      fireEvent.click(screen.getByRole('button', { name: 'Nâng model hàng loạt' }));
      return screen.findByRole('dialog');
    }

    it('xem trước hiện số chỗ, xác nhận gửi lại đúng body với dryRun false, kết quả hiện agent đã đổi', async () => {
      const calls: { dryRun: boolean }[] = [];
      mount(OWNER_VIEW, {
        [UPGRADE]: (init) => {
          const body = JSON.parse(String(init?.body)) as { dryRun: boolean };
          calls.push(body);
          return { body: upgraded({}, body.dryRun) };
        },
      });
      const dialog = await openDialog();
      await pick('Model cũ', 'claude-sonnet-5');
      fireEvent.change(within(dialog).getByLabelText('Model mới'), { target: { value: 'claude-sonnet-5-5' } });
      expect(within(dialog).queryByLabelText('Model mới xem được ảnh')).toBeNull();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Xem trước' }));
      expect(await within(dialog).findByText('Ô bảng độ khó: 2 (trivial, small)')).toBeTruthy();
      expect(within(dialog).getByText('Vai: 1 (executor)')).toBeTruthy();
      expect(within(dialog).getByText('Agent: 1')).toBeTruthy();
      expect(within(dialog).getByText('Issue đang mở: 1')).toBeTruthy();
      expect(within(dialog).getByText('Agent bỏ qua: 1')).toBeTruthy();
      expect(within(dialog).getByText(/gộp model cũ vào model mới/)).toBeTruthy();
      expect(within(dialog).getByText('Tổng: 6 chỗ')).toBeTruthy();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Nâng 6 chỗ' }));
      expect(await screen.findByText('Đã nâng model, bản r4: 6 chỗ')).toBeTruthy();
      expect(calls.map((c) => c.dryRun)).toEqual([true, false]);
      expect(screen.queryByText('Khác xem trước vì dữ liệu vừa đổi.')).toBeNull();
      expect(screen.getByText('Agent đã đổi model: 1')).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('model mới là id lạ thì hỏi cờ xem ảnh và gửi vision', async () => {
      const bodies: Record<string, unknown>[] = [];
      mount(OWNER_VIEW, {
        [UPGRADE]: (init) => {
          bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return { body: upgraded({ catalog: 'renamed' }) };
        },
      });
      const dialog = await openDialog();
      await pick('Model cũ', 'claude-sonnet-5');
      fireEvent.change(within(dialog).getByLabelText('Model mới'), { target: { value: 'claude-sonnet-6' } });
      const vision = within(dialog).getByRole('checkbox', { name: 'Model mới xem được ảnh' });
      expect(vision.getAttribute('aria-checked')).toBe('true');
      fireEvent.click(vision);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Xem trước' }));
      await within(dialog).findByText('Tổng: 6 chỗ');
      expect(bodies[0]).toEqual({
        baseRevision: 3,
        runtime: 'claude_local',
        fromModel: 'claude-sonnet-5',
        toModel: 'claude-sonnet-6',
        vision: false,
        dryRun: true,
      });
    });

    it('số thật khác bản xem trước thì ghi rõ "khác xem trước"', async () => {
      mount(OWNER_VIEW, {
        [UPGRADE]: (init) => {
          const dry = (JSON.parse(String(init?.body)) as { dryRun: boolean }).dryRun;
          return { body: upgraded(dry ? {} : { issues: [] }, dry) };
        },
      });
      const dialog = await openDialog();
      await pick('Model cũ', 'claude-sonnet-5');
      fireEvent.change(within(dialog).getByLabelText('Model mới'), { target: { value: 'claude-sonnet-5-5' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Xem trước' }));
      fireEvent.click(await within(dialog).findByRole('button', { name: 'Nâng 6 chỗ' }));
      expect(await screen.findByText('Khác xem trước vì dữ liệu vừa đổi.')).toBeTruthy();
      expect(screen.getByText('Đã nâng model, bản r4: 5 chỗ')).toBeTruthy();
    });

    it('server từ chối (ví dụ model mới không xem được ảnh ở mức large) thì báo ngay trong hộp thoại', async () => {
      mount(OWNER_VIEW, {
        [UPGRADE]: {
          status: 422,
          body: {
            error: 'invalid',
            code: 'crew_model_settings_invalid',
            issues: [
              { path: 'catalog.claude_local.byComplexity.large.model', message: 'mức large cần model xem được ảnh' },
            ],
          },
        },
      });
      const dialog = await openDialog();
      await pick('Model cũ', 'claude-opus-5-5');
      fireEvent.change(within(dialog).getByLabelText('Model mới'), { target: { value: 'khong-anh' } });
      fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Model mới xem được ảnh' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Xem trước' }));
      expect(await within(dialog).findByText('mức large cần model xem được ảnh')).toBeTruthy();
      expect(within(dialog).queryByRole('button', { name: /^Nâng \d+ chỗ$/ })).toBeNull();
    });

    it('Xem trước tắt khi chưa nhập model mới hoặc model mới trùng model cũ', async () => {
      mount();
      const dialog = await openDialog();
      const preview = within(dialog).getByRole('button', { name: 'Xem trước' }) as HTMLButtonElement;
      expect(preview.disabled).toBe(true);
      await pick('Model cũ', 'claude-sonnet-5');
      fireEvent.change(within(dialog).getByLabelText('Model mới'), { target: { value: 'claude-sonnet-5' } });
      expect(preview.disabled).toBe(true);
    });
  });
});
