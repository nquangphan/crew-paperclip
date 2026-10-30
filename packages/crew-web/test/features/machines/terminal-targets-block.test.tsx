// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MachinesPage } from '@/features/machines/machines-page';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer } from '../../app/fetch-mock';
import { data, renderPage } from '../agents/helpers';
import { M1, M2, machine } from './fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TARGETS = 'GET /api/crew/companies/c-tps/terminal/targets';
const target = (machineId: string, hostname: string, projectId: string, projectName: string, projectKey: string) => ({
  machineId,
  hostname,
  projectId,
  projectName,
  projectKey,
  branch: 'main',
});
const base = (extra: Record<string, unknown> = {}) => ({
  ...data('crew.machines', [machine(), machine({ machineId: M2, hostname: 'mac-studio' })]),
  ...data('crew.machineJobs', []),
  'GET /api/plugins/crew.core/api/runtime-switches?companyId=c-tps': { body: { machines: [] } },
  ...extra,
});
const mount = () => renderPage(<MachinesPage />, { route: 'machines', at: '/TPS/machines' });

describe('khối Terminal trên trang Máy', () => {
  it('owner thấy dự án nhóm theo máy, link mở tab mới tới trang terminal', async () => {
    mockServer(
      base({
        [TARGETS]: {
          body: {
            items: [
              target(M1, 'mac-mini', P1, 'Paperclip', 'paperclip'),
              target(M1, 'mac-mini', P2, 'Kidy School', 'kidy_school'),
              target(M2, 'mac-studio', P3, 'My Money', 'my_money'),
            ],
          },
        },
      }),
    );
    mount();
    const section = await screen.findByRole('region', { name: 'Terminal' });
    const mini = await within(section).findByRole('group', { name: 'mac-mini' });
    const studio = within(section).getByRole('group', { name: 'mac-studio' });
    const links = within(mini).getAllByRole('link', { name: 'Mở terminal' });
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      `/TPS/terminal/${M1}/${P1}`,
      `/TPS/terminal/${M1}/${P2}`,
    ]);
    for (const a of links) expect(a.getAttribute('target')).toBe('_blank');
    expect(within(mini).getByText('paperclip')).toBeTruthy();
    expect(within(mini).getByText('Kidy School')).toBeTruthy();
    expect(within(studio).getByRole('link', { name: 'Mở terminal' }).getAttribute('href')).toBe(
      `/TPS/terminal/${M2}/${P3}`,
    );
  });

  it('chưa có dự án nào dựng xong thì ghi rõ', async () => {
    mockServer(base({ [TARGETS]: { body: { items: [] } } }));
    mount();
    expect(await screen.findByText('Chưa có dự án nào dựng xong trên máy.')).toBeTruthy();
  });

  it('không phải owner thì không hiện khối và không gọi API', async () => {
    const s = mockServer(
      base({
        ...accessRoute('c-tps', { userId: 'u2', membershipRole: 'viewer', contributor: false, canApprove: false }),
        [TARGETS]: { body: { items: [target(M1, 'mac-mini', P1, 'Paperclip', 'paperclip')] } },
      }),
    );
    mount();
    await screen.findByText('mac-mini');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('region', { name: 'Terminal' })).toBeNull();
    expect(s.calls.some((c) => c.url.includes('/terminal/'))).toBe(false);
  });
});
