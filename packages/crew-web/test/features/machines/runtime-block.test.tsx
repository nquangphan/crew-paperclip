// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MachinesPage } from '@/features/machines/machines-page';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { data, renderPage } from '../agents/helpers';
import { job, M1, machine, ROUTE, RUNTIMES, SWITCH_SET, switches } from './fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const SWITCHES_GET = 'GET /api/plugins/crew.core/api/runtime-switches?companyId=c-tps';
const setCalls = (s: { calls: { method: string; url: string; body: unknown }[] }) =>
  s.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/runtime-switches'));
const mount = () => renderPage(<MachinesPage />, { route: 'machines', at: '/TPS/machines' });
const base = (extra: Record<string, unknown> = {}) => ({
  ...data('crew.machines', [machine({ runtimes: RUNTIMES })]),
  ...data('crew.machineJobs', []),
  [SWITCHES_GET]: { body: { machines: [switches()] } },
  ...extra,
});
const block = async () => within(await screen.findByRole('region', { name: 'Runtime mac-mini' }));

describe('khối Runtime trên thẻ máy', () => {
  it('hiện ba runtime với trạng thái từ bản tin: phiên bản, đăng nhập, quota Codex, key và chi phí OpenCode', async () => {
    mockServer(base());
    mount();
    const b = await block();
    expect(b.getByText(/Claude/)).toBeTruthy();
    expect(b.getByText(/0\.9\.1/)).toBeTruthy();
    expect(b.getByText(/42%/)).toBeTruthy();
    expect(b.getByText(/07:30/)).toBeTruthy(); // 00:30Z = 07:30 Asia/Ho_Chi_Minh
    expect(b.getByText(/1\.4\.0/)).toBeTruthy();
    expect(b.getByText(/Chưa có key/)).toBeTruthy();
    expect(b.getByText(/\$3,50\/\$12,00/)).toBeTruthy();
    expect(b.getByText(/\$10,00\/\$30,00/)).toBeTruthy();
    expect(b.getByText(/\$20,00\/\$60,00/)).toBeTruthy();
    expect(b.getByText(/crew-mac runtimes key opencode/)).toBeTruthy();
  });

  it('Codex và OpenCode tắt sẵn; Claude bật', async () => {
    mockServer(base());
    mount();
    const b = await block();
    expect(b.getByRole('switch', { name: 'Claude trên mac-mini' }).getAttribute('aria-checked')).toBe('true');
    expect(b.getByRole('switch', { name: 'Codex trên mac-mini' }).getAttribute('aria-checked')).toBe('false');
    expect(b.getByRole('switch', { name: 'OpenCode trên mac-mini' }).getAttribute('aria-checked')).toBe('false');
  });

  it('OpenCode bị khóa thì tắt nút và hiện lý do', async () => {
    mockServer(base());
    mount();
    const b = await block();
    expect((b.getByRole('switch', { name: 'OpenCode trên mac-mini' }) as HTMLButtonElement).disabled).toBe(true);
    expect(b.getByText(/server chưa có vá chạy OpenCode/)).toBeTruthy();
  });

  it('công tắc OpenCode bị khóa có title nêu lý do khóa và việc chưa nạp key', async () => {
    mockServer(base());
    mount();
    const b = await block();
    const title = b.getByRole('switch', { name: 'OpenCode trên mac-mini' }).getAttribute('title') ?? '';
    expect(title).toMatch(/server chưa có vá chạy OpenCode/);
    expect(title).toMatch(/Chưa nạp key OpenCode trên máy/);
    expect(b.getByRole('switch', { name: 'Claude trên mac-mini' }).hasAttribute('title')).toBe(false);
  });

  it('khóa mà bản tin báo đã có key thì title không nói thiếu key', async () => {
    const withKey = { ...RUNTIMES, opencode: { ...RUNTIMES.opencode, keyPresent: true } };
    mockServer(base(data('crew.machines', [machine({ runtimes: withKey })])));
    mount();
    const b = await block();
    const title = b.getByRole('switch', { name: 'OpenCode trên mac-mini' }).getAttribute('title') ?? '';
    expect(title).toMatch(/server chưa có vá/);
    expect(title).not.toMatch(/Chưa nạp key/);
  });

  it('bản tin chưa có runtimes thì báo chưa có số liệu, vẫn gạt được', async () => {
    mockServer(base(data('crew.machines', [machine()])));
    mount();
    const b = await block();
    expect(b.getAllByText('Chưa có bản tin runtime').length).toBe(2);
    expect((b.getByRole('switch', { name: 'Codex trên mac-mini' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('bật Codex phải qua hộp xác nhận rồi POST runtime-switches', async () => {
    const s = mockServer(
      base({
        [SWITCH_SET]: {
          body: { ok: true, runtimes: switches(M1, 'mac-mini', { codex_local: { enabled: true } }).runtimes },
        },
      }),
    );
    mount();
    const b = await block();
    fireEvent.click(b.getByRole('switch', { name: 'Codex trên mac-mini' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Run mới của runtime này sẽ dùng quota/)).toBeTruthy();
    expect(setCalls(s).length > 0).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bật Codex' }));
    await waitFor(() => expect(setCalls(s).length > 0).toBe(true));
    expect(setCalls(s)[0]?.body).toEqual({
      companyId: 'c-tps',
      machineId: M1,
      runtime: 'codex_local',
      enabled: true,
    });
  });

  it('Hủy hộp xác nhận thì không gọi server', async () => {
    const s = mockServer(base());
    mount();
    const b = await block();
    fireEvent.click(b.getByRole('switch', { name: 'Codex trên mac-mini' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    expect(setCalls(s).length > 0).toBe(false);
  });

  it('tắt Claude phải qua hộp xác nhận nói rõ mọi run Claude trên máy bị giữ, rồi mới POST', async () => {
    const s = mockServer(
      base({
        [SWITCH_SET]: {
          body: { ok: true, runtimes: switches(M1, 'mac-mini', { claude_local: { enabled: false } }).runtimes },
        },
      }),
    );
    mount();
    const b = await block();
    fireEvent.click(b.getByRole('switch', { name: 'Claude trên mac-mini' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Tắt Claude trên mac-mini?')).toBeTruthy();
    expect(within(dialog).getByText(/Trợ Lý, reviewer, integrator/)).toBeTruthy();
    expect(within(dialog).getByText(/bị giữ/)).toBeTruthy();
    expect(setCalls(s).length > 0).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tắt Claude' }));
    await waitFor(() => expect(setCalls(s).length > 0).toBe(true));
    expect(setCalls(s)[0]?.body).toMatchObject({ runtime: 'claude_local', enabled: false });
  });

  it('Hủy hộp xác nhận tắt Claude thì không gọi server', async () => {
    const s = mockServer(base());
    mount();
    const b = await block();
    fireEvent.click(b.getByRole('switch', { name: 'Claude trên mac-mini' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    expect(setCalls(s).length > 0).toBe(false);
  });

  it('403 và 409 hiện nguyên văn lời server', async () => {
    mockServer(base({ [SWITCH_SET]: { status: 403, body: { error: 'Chỉ board được bật/tắt runtime' } } }));
    mount();
    const b = await block();
    fireEvent.click(b.getByRole('switch', { name: 'Claude trên mac-mini' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Tắt Claude' }));
    expect(await screen.findByText('Chỉ board được bật/tắt runtime')).toBeTruthy();
  });

  it('nút "Cài runtime trên máy" xếp việc runtimes-setup cho đúng máy', async () => {
    const s = mockServer(
      base({
        [`${ROUTE}/machine-jobs`]: {
          body: job({ id: 'j-rt', kind: 'runtimes-setup' as never, payload: { kind: 'runtimes-setup' } }),
        },
      }),
    );
    mount();
    const b = await block();
    fireEvent.click(b.getByRole('button', { name: 'Cài runtime trên máy' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'POST' && c.url.endsWith('/machine-jobs'))).toBe(true));
    expect(s.calls.find((c) => c.url.endsWith('/machine-jobs') && c.method === 'POST')?.body).toEqual({
      companyId: 'c-tps',
      machineId: M1,
      kind: 'runtimes-setup',
      payload: { kind: 'runtimes-setup' },
    });
  });

  it('việc runtimes-setup đang chờ khóa nút; xong thì hiện kết quả; lỗi thì hiện lỗi', async () => {
    const waiting = job({
      id: 'j1',
      kind: 'runtimes-setup' as never,
      payload: { kind: 'runtimes-setup' },
      status: 'queued',
    });
    mockServer(base(data('crew.machineJobs', [waiting])));
    mount();
    const b = await block();
    expect((b.getByRole('button', { name: 'Cài runtime trên máy' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    const done = job({
      id: 'j2',
      kind: 'runtimes-setup' as never,
      payload: { kind: 'runtimes-setup' },
      status: 'done',
      result: {
        kind: 'runtimes-setup',
        wrappers: { codex: true, opencode: false },
        codex: { version: '0.9.1', loggedIn: true },
        opencode: { version: null, keyPresent: false },
      } as never,
    });
    mockServer(base(data('crew.machineJobs', [done])));
    mount();
    const b2 = await block();
    expect(await b2.findByText(/Wrapper Codex: đã cài/)).toBeTruthy();
    expect(b2.getByText(/Wrapper OpenCode: chưa cài/)).toBeTruthy();
    cleanup();

    const failed = job({
      id: 'j3',
      kind: 'runtimes-setup' as never,
      payload: { kind: 'runtimes-setup' },
      status: 'failed',
      errorText: 'App không cài được wrapper',
    });
    mockServer(base(data('crew.machineJobs', [failed])));
    mount();
    const b3 = await block();
    expect(await b3.findByText('App không cài được wrapper')).toBeTruthy();
  });

  it('không tải được công tắc thì báo lỗi trong khối, thẻ máy vẫn hiện', async () => {
    mockServer(base({ [SWITCHES_GET]: { status: 500, body: { error: 'Không đọc/ghi được công tắc runtime' } } }));
    mount();
    expect(await screen.findByText('mac-mini')).toBeTruthy();
    expect(await screen.findByText('Không đọc/ghi được công tắc runtime')).toBeTruthy();
  });
});
