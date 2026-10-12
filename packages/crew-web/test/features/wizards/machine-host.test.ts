import { describe, expect, it } from 'vitest';
import type { SetupRun } from '@/api';
import {
  type EnvironmentRow,
  machineTargetOf,
  pickTemplate,
  StepError,
  templateFor,
} from '@/features/wizards/add-project/run-step';
import {
  type HostMachine,
  machineHost,
  machineOfHost,
  projectCheckoutOn,
  projectMachine,
  rootFromInspectError,
} from '@/features/wizards/machine-host';

const MINI_IP = '100.102.189.67';
const BOOK_IP = '100.100.157.19';
const SECRET = 'sec-1';

/** Environment SSH in_place có đủ trường để làm mẫu. */
function env(id: string, host: string, path: string, over: Partial<EnvironmentRow> = {}): EnvironmentRow {
  return {
    id,
    name: id,
    driver: 'ssh',
    status: 'active',
    config: {
      host,
      port: 2222,
      username: 'owner',
      remoteWorkspacePath: path,
      privateKeySecretRef: { type: 'secret_ref', secretId: SECRET, version: 'latest' },
      knownHosts: `${host} ssh-ed25519 AAAA`,
    },
    metadata: { workspaceRealizationMode: 'in_place' },
    createdAt: '2026-10-01T00:00:00Z',
    ...over,
  };
}

const ck = (key: string, role: string) => `/Users/owner/crew-agents/${key}/${role}`;
const checkouts = (...paths: string[]) => ({ checkouts: paths.map((path) => ({ path })) });

// Mac mini ghép tay (không có pairing), MacBook ghép cặp qua app. Cùng user nên đường checkout giống nhau.
const MINI: HostMachine = {
  machineId: 'm-mini',
  hostname: 'mac-mini',
  latest: checkouts(ck('paperclip', 'executor'), ck('kidy', 'executor-1'), ck('kidy', 'executor-2')),
  pairing: null,
};
const BOOK: HostMachine = {
  machineId: 'm-book',
  hostname: 'Phans-MacBook-Pro.local',
  latest: checkouts(ck('docs', 'assistant'), ck('docs', 'executor-1'), ck('kidy', 'executor-1')),
  pairing: { environmentId: 'env-book-pair', tailscaleIp: BOOK_IP },
};
const MACHINES = [MINI, BOOK];

const ENVS = [
  env('env-paperclip-executor', MINI_IP, ck('paperclip', 'executor'), { createdAt: '2026-10-02T00:00:00Z' }),
  env('env-book-pair', BOOK_IP, '/Users/owner', { createdAt: '2026-09-01T00:00:00Z' }),
  env('env-docs-assistant', BOOK_IP, ck('docs', 'assistant'), { createdAt: '2026-10-03T00:00:00Z' }),
  env('env-docs-executor-1', BOOK_IP, ck('docs', 'executor-1'), { createdAt: '2026-10-04T00:00:00Z' }),
  // Environment sai máy (lỗi cũ): checkout chỉ MacBook có mà host là Mac mini. Mới nhất của company.
  env('env-docs-executor-2', MINI_IP, ck('docs', 'executor-2'), { createdAt: '2026-10-12T00:00:00Z' }),
];

describe('machineHost', () => {
  it('máy ghép cặp: IP Tailscale của lần ghép', () => {
    expect(machineHost(BOOK, MACHINES, ENVS)).toBe(BOOK_IP);
  });

  it('máy ghép cặp thiếu IP: host của environment ghép cặp', () => {
    const book = { ...BOOK, pairing: { environmentId: 'env-book-pair', tailscaleIp: null } };
    expect(machineHost(book, [MINI, book], ENVS)).toBe(BOOK_IP);
  });

  it('máy ghép tay: host đa số environment trỏ checkout chỉ máy đó báo, bỏ host thuộc máy ghép cặp', () => {
    expect(machineHost(MINI, MACHINES, ENVS)).toBe(MINI_IP);
  });

  it('checkout cả hai máy cùng báo thì không tính; không còn gì thì null', () => {
    const mini = { ...MINI, latest: checkouts(ck('kidy', 'executor-1')) };
    const envs = [env('env-kidy', MINI_IP, ck('kidy', 'executor-1'))];
    expect(machineHost(mini, [mini, BOOK], envs)).toBeNull();
  });

  it('hai host hòa phiếu thì null', () => {
    const mini = { ...MINI, latest: checkouts(ck('a', 'x'), ck('b', 'y')) };
    const envs = [env('e1', '100.64.0.1', ck('a', 'x')), env('e2', '100.64.0.2', ck('b', 'y'))];
    expect(machineHost(mini, [mini], envs)).toBeNull();
  });

  it('machineOfHost: host ra đúng một máy', () => {
    expect(machineOfHost(BOOK_IP, MACHINES, ENVS)?.machineId).toBe('m-book');
    expect(machineOfHost(MINI_IP, MACHINES, ENVS)?.machineId).toBe('m-mini');
    expect(machineOfHost('100.64.9.9', MACHINES, ENVS)).toBeNull();
  });
});

describe('projectMachine, projectCheckoutOn (project thêm từ app Mac, không có lần thêm project)', () => {
  const roleEnvs = ENVS.filter((e) => e.id.startsWith('env-docs-') && e.id !== 'env-docs-executor-2');

  it('máy theo host SSH của environment agent vai trò', () => {
    expect(projectMachine({ key: 'docs', roleEnvs, machines: MACHINES, envs: ENVS })).toBe('m-book');
  });

  it('host không ra máy thì theo máy báo có checkout của environment', () => {
    const lone = [env('env-x', '10.0.0.1', ck('docs', 'assistant'))];
    expect(projectMachine({ key: 'docs', roleEnvs: lone, machines: MACHINES, envs: lone })).toBe('m-book');
  });

  it('agent vai trò ở hai máy khác nhau thì không đoán', () => {
    const split = [...roleEnvs, ENVS[0] as EnvironmentRow];
    expect(projectMachine({ key: 'docs', roleEnvs: split, machines: MACHINES, envs: ENVS })).toBe('');
  });

  it('không có environment vai trò: máy duy nhất báo checkout của khóa', () => {
    expect(projectMachine({ key: 'docs', roleEnvs: [], machines: MACHINES, envs: ENVS })).toBe('m-book');
    // Khóa có checkout trên cả hai máy: không đoán.
    expect(projectMachine({ key: 'kidy', roleEnvs: [], machines: MACHINES, envs: ENVS })).toBe('');
  });

  it('checkout để hỏi repo gốc: checkout của agent vai trò mà máy đã chọn báo, rồi checkout bất kỳ của khóa', () => {
    const placement = { key: 'docs', roleEnvs, machines: MACHINES };
    expect(projectCheckoutOn('m-book', placement)).toBe(ck('docs', 'assistant'));
    expect(projectCheckoutOn('m-book', { ...placement, roleEnvs: [] })).toBe(ck('docs', 'assistant'));
    expect(projectCheckoutOn('m-mini', placement)).toBeNull();
    expect(projectCheckoutOn('m-book', { ...placement, key: '' })).toBeNull();
  });
});

describe('rootFromInspectError', () => {
  it('đọc repo gốc từ lỗi worktree phụ của app Mac', () => {
    const text =
      '/Users/owner/crew-agents/kidy-school-2-0-docs/executor-1 là worktree phụ của repo ' +
      '/Users/owner/Documents/projects/kidy_school_2.0_docs: chọn thư mục repo chính (worktree chính)';
    expect(rootFromInspectError(text)).toBe('/Users/owner/Documents/projects/kidy_school_2.0_docs');
  });

  it('lỗi khác, rỗng, hay gốc nằm trong crew-agents thì null', () => {
    expect(rootFromInspectError('/x không phải repo git: chọn thư mục gốc của repo')).toBeNull();
    expect(rootFromInspectError(null)).toBeNull();
    expect(
      rootFromInspectError('/a là worktree phụ của repo /Users/o/crew-agents/k/assistant: chọn thư mục repo chính'),
    ).toBeNull();
  });
});

describe('pickTemplate theo máy (hai máy)', () => {
  const ids = new Set([SECRET]);

  it('chỉ chọn mẫu trên đúng host, kể cả khi mẫu mới nhất của company ở máy khác', () => {
    expect(pickTemplate(ENVS, ids, { host: BOOK_IP })?.config.host).toBe(BOOK_IP);
    expect(pickTemplate(ENVS, ids, { host: MINI_IP })?.config.host).toBe(MINI_IP);
  });

  it('ưu tiên mẫu của agent cùng project trên máy đó, rồi crewLoadGate, rồi mới nhất', () => {
    const gated = env('env-gate', BOOK_IP, ck('other', 'x'), {
      metadata: { workspaceRealizationMode: 'in_place', crewLoadGate: { maxLoad1: 8 } },
      createdAt: '2026-10-11T00:00:00Z',
    });
    const envs = [...ENVS, gated];
    expect(pickTemplate(envs, ids, { host: BOOK_IP, projectKey: 'docs' })?.id).toBe('env-docs-executor-1');
    expect(pickTemplate(envs, ids, { host: BOOK_IP, projectKey: 'moi' })?.id).toBe('env-gate');
    expect(pickTemplate(envs, ids, { host: BOOK_IP })?.id).toBe('env-gate');
  });

  it('máy không có mẫu nào thì null, không lấy mẫu của máy khác', () => {
    expect(pickTemplate(ENVS, ids, { host: '100.64.0.9' })).toBeNull();
  });
});

describe('machineTargetOf, templateFor', () => {
  const run = (machineId: string) => ({ companyId: 'c1', machineId }) as SetupRun;
  const api = (machines: HostMachine[]) => ({
    crew: { machines: async () => machines },
    secrets: { list: async () => [{ id: SECRET }] },
  });

  it('máy của run là MacBook: mẫu của MacBook, không phải environment mới nhất (Mac mini)', async () => {
    const target = await machineTargetOf(api(MACHINES), run('m-book'), ENVS);
    expect(target).toMatchObject({ host: BOOK_IP, label: 'Phans-MacBook-Pro.local' });
    expect(templateFor(target, 'docs').id).toBe('env-docs-executor-1');
  });

  it('máy chưa có mẫu: dừng bước với noMachineTemplate', async () => {
    const book = { ...BOOK, pairing: { environmentId: 'env-khac', tailscaleIp: '100.64.7.7' } };
    const target = await machineTargetOf(api([MINI, book]), run('m-book'), ENVS);
    expect(() => templateFor(target, 'docs')).toThrowError(StepError);
    expect(() => templateFor(target, 'docs')).toThrowError('errors.noMachineTemplate');
  });

  it('không biết host của máy: noMachineHost (hai máy, máy ghép tay chưa có environment nào)', async () => {
    const bare = { machineId: 'm-new', hostname: 'mac-moi', latest: checkouts() };
    const target = await machineTargetOf(api([bare, BOOK]), run('m-new'), ENVS);
    expect(target.host).toBeNull();
    expect(() => templateFor(target, 'docs')).toThrowError('errors.noMachineHost');
  });

  it('company chỉ một máy, không suy được host: nhận host khi mọi mẫu cùng một host', async () => {
    const bare = { machineId: 'm-one', hostname: 'mac', latest: checkouts() };
    const envs = [env('e1', 'mac.local', ck('old', 'assistant'))];
    expect((await machineTargetOf(api([bare]), run('m-one'), envs)).host).toBe('mac.local');
    const two = [...envs, env('e2', 'other.local', ck('old', 'executor'))];
    expect((await machineTargetOf(api([bare]), run('m-one'), two)).host).toBeNull();
  });
});
