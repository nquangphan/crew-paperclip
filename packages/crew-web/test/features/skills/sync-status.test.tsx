// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SyncStatus } from '@/features/skills/sync-status';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { data, renderWith } from '../agents/helpers';
import { job, M1, M2, machine, ROUTE, SKILL_ID } from '../machines/fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const SKILL = { id: SKILL_ID, slug: 'viet-test', version: '1' };
const SHA = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
const state = (over: Record<string, unknown>) => ({
  skillId: SKILL_ID,
  machineId: M1,
  status: 'done',
  sha256: SHA,
  finishedAt: '2026-10-10T01:00:00Z',
  ...over,
});

describe('SyncStatus (S14.4)', () => {
  it('việc done có sha256 thì hiện "đã có trên <máy>, hash <12 ký tự>"', async () => {
    mockServer({ ...data('crew.skillSync', [state({})]), ...data('crew.machineJobs', []) });
    renderWith(<SyncStatus skill={SKILL} machines={[machine()]} />);
    expect(await screen.findByText('Đã có trên mac-mini, hash abcdef012345')).toBeTruthy();
    expect(screen.queryByText(/abcdef0123456/)).toBeNull();
  });

  it('việc failed hiện lỗi đã làm sạch kèm nút Thử lại gọi jobs.retry theo jobId', async () => {
    const s = mockServer({
      ...data('crew.skillSync', [
        state({
          status: 'failed',
          sha256: null,
          jobId: 'j-new',
          errorCode: 'download',
          errorText: 'Không tải được skill',
        }),
      ]),
      ...data('crew.machineJobs', []),
      [`${ROUTE}/machine-jobs/j-new/retry`]: { body: job({ id: 'j-new', status: 'queued' }) },
    });
    renderWith(<SyncStatus skill={SKILL} machines={[machine()]} />);
    expect(await screen.findByText(/Không tải được skill/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(s.calls.some((c) => c.url.endsWith('/machine-jobs/j-new/retry'))).toBe(true));
    expect(s.calls.find((c) => c.url.endsWith('/retry'))?.body).toEqual({ companyId: 'c-tps' });
  });

  it('việc chờ vẫn cho thấy bản máy đang giữ', async () => {
    mockServer({ ...data('crew.skillSync', [state({ status: 'queued' })]), ...data('crew.machineJobs', []) });
    renderWith(<SyncStatus skill={SKILL} machines={[machine()]} />);
    expect(await screen.findByText(/Đang chờ đồng bộ lên mac-mini/)).toBeTruthy();
    expect(screen.getByText(/abcdef012345/)).toBeTruthy();
  });

  it('chưa đồng bộ thì có nút Đồng bộ tạo một việc skill-sync cho máy đó', async () => {
    const s = mockServer({
      ...data('crew.skillSync', []),
      ...data('crew.machineJobs', []),
      [`${ROUTE}/machine-jobs`]: { status: 201, body: job({ id: 'j1' }) },
    });
    renderWith(<SyncStatus skill={SKILL} machines={[machine()]} />);
    expect(await screen.findByText('Chưa đồng bộ lên mac-mini')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Đồng bộ' }));
    await waitFor(() => expect(s.calls.some((c) => c.url.endsWith('/machine-jobs'))).toBe(true));
    expect(s.calls.find((c) => c.url.endsWith('/machine-jobs'))?.body).toEqual({
      companyId: 'c-tps',
      machineId: M1,
      kind: 'skill-sync',
      payload: { kind: 'skill-sync', skillId: SKILL_ID, slug: 'viet-test', version: '1' },
    });
  });

  it('máy chưa có app nhận việc thì báo chờ app và không có nút Đồng bộ', async () => {
    mockServer({ ...data('crew.skillSync', []), ...data('crew.machineJobs', []) });
    renderWith(
      <SyncStatus
        skill={SKILL}
        machines={[machine({ jobsAgent: false }), machine({ machineId: M2, hostname: 'mac-studio' })]}
      />,
    );
    expect(await screen.findByText('Chờ app 2P Crew trên mac-mini')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Đồng bộ' })).toHaveLength(1);
  });

  it('không có máy nào thì báo trống', async () => {
    mockServer({ ...data('crew.skillSync', []), ...data('crew.machineJobs', []) });
    renderWith(<SyncStatus skill={SKILL} machines={[]} />);
    expect(await screen.findByText('Chưa có máy nào báo tin')).toBeTruthy();
  });
});
