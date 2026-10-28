// Company mẫu "2P Demo" cho ảnh trang Hướng dẫn (chỉ stack T1): dữ liệu tiếng Việt dễ đọc thay cho dữ liệu e2e.
// Dựng bằng REST và route plugin như wizard và app Mac làm, tìm theo tên trước khi tạo nên chạy lại không sinh bản
// trùng. Mỗi lượt gửi lại bản tin máy (máy hiện Trực tuyến) và ảnh chụp docs.
//
//   - 2 project có vai trò đủ và "Sẵn sàng": agent Claude đúng cấu hình Crew (heartbeat tắt, không tự chạy khi được
//     giao việc), AGENTS.md theo template, environment SSH in_place trỏ checkout mà bản tin máy liệt kê;
//   - 2 máy đã ghép (route ghép máy của plugin), bản tin ký bằng key máy;
//   - 11 yêu cầu gốc ở nhiều trạng thái, 6 yêu cầu con, vài bình luận của owner; một yêu cầu chờ owner duyệt, một
//     yêu cầu nghiên cứu ở bước Reviewer;
//   - góp ý của Phòng Marketing: một yêu cầu và một bình luận chờ duyệt, một yêu cầu bị từ chối;
//   - docs của project Website bán hàng.
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  CREW_AGENT_PERMISSIONS,
  type CrewRoleSlot,
  crewAgentCreateBody,
  defaultModelOf,
  roleOfSlot,
} from '../../src/lib/instructions/agent-config';
import type { Api } from './api';
import { isProd } from './env';
import type { E2eCompany } from './fixtures';
import { loadModelSettings } from './model-settings';

export const GUIDE_COMPANY_NAME = '2P Demo';
const PLUGIN = '/api/plugins/crew.core';
const HOME = '/Users/crew';
const PIN_DIR = `${HOME}/.crew/workflows/superpowers/6.4.1`;
const TEMPLATES = path.resolve(import.meta.dirname, '..', '..', '..', '..', 'crew', 'agents');

interface MachineSpec {
  hostname: string;
  ip: string;
  load1: number;
  memFreePct: number;
}
const MACHINES: readonly MachineSpec[] = [
  { hostname: 'mac-mini-van-phong', ip: '100.64.10.11', load1: 1.8, memFreePct: 46 },
  { hostname: 'macbook-pro-giang', ip: '100.64.10.12', load1: 0.6, memFreePct: 63 },
];

interface ProjectSpec {
  key: string;
  name: string;
  description: string;
  color: string;
  executors: 1 | 2;
}
export const GUIDE_PROJECTS: readonly ProjectSpec[] = [
  {
    key: 'web-ban-hang',
    name: 'Website bán hàng',
    description: 'Trang bán hàng trực tuyến: danh mục, giỏ hàng, thanh toán, báo cáo.',
    color: '#2563eb',
    executors: 2,
  },
  {
    key: 'app-giao-hang',
    name: 'Ứng dụng giao hàng',
    description: 'Ứng dụng di động cho tài xế giao hàng.',
    color: '#16a34a',
    executors: 1,
  },
];

type Status = 'backlog' | 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
interface ChildSpec {
  title: string;
  status: Status;
  slot: CrewRoleSlot;
}
interface IssueSpec {
  key: string;
  project: string;
  title: string;
  description: string;
  kind: 'code' | 'research';
  status: Status;
  /**
   * `owner`: chờ owner duyệt (policy chỉ có bước duyệt của owner, vì đi qua bước Reviewer cần một run thật của agent);
   * `reviewer`: dừng ở bước Reviewer của quy trình Crew.
   */
  stage?: 'owner' | 'reviewer';
  children?: ChildSpec[];
  /** Bình luận của owner. Agent mẫu không chạy nên không có run để ghi bình luận của agent. */
  comments?: string[];
}

const ISSUES: readonly IssueSpec[] = [
  {
    key: 'excel',
    project: 'web-ban-hang',
    title: 'Thêm nút xuất Excel ở trang báo cáo doanh thu',
    description:
      'Trang **Báo cáo doanh thu** cần nút **Xuất Excel**.\n\n- File có cột Ngày, Đơn hàng, Tổng tiền.\n- Không đổi cách tính tổng hiện có.',
    kind: 'code',
    status: 'in_progress',
    stage: 'owner',
    children: [
      { title: 'Viết hàm tạo file Excel từ dữ liệu báo cáo', status: 'done', slot: 'executor' },
      { title: 'Thêm nút Xuất Excel và test giao diện', status: 'done', slot: 'executor-2' },
    ],
    comments: ['Đã thử file xuất ra trên máy, mở bằng Excel và Google Sheets đều đúng.'],
  },
  {
    key: 'ship-fee',
    project: 'web-ban-hang',
    title: 'Sửa lỗi tính sai phí vận chuyển cho đơn trên 2 kg',
    description: 'Đơn nặng 2,5 kg bị tính phí như đơn 1 kg. Đúng ra phải cộng thêm phí theo mỗi 0,5 kg vượt.',
    kind: 'code',
    status: 'in_progress',
    children: [
      { title: 'Viết test tái hiện lỗi phí vận chuyển', status: 'done', slot: 'executor' },
      { title: 'Sửa công thức tính phí theo cân nặng', status: 'in_progress', slot: 'executor' },
      { title: 'Cập nhật tài liệu bảng phí vận chuyển', status: 'todo', slot: 'executor-2' },
    ],
    comments: ['Ưu tiên sửa trước đợt khuyến mãi cuối tuần.'],
  },
  {
    key: 'payment-research',
    project: 'web-ban-hang',
    title: 'So sánh ba cổng thanh toán VNPay, MoMo, ZaloPay',
    description: 'So sánh phí, thời gian đối soát và cách tích hợp. Đề xuất một cổng cho quý tới.',
    kind: 'research',
    status: 'in_progress',
    stage: 'reviewer',
  },
  {
    key: 'region-filter',
    project: 'web-ban-hang',
    title: 'Thêm bộ lọc theo khu vực ở trang khách hàng',
    description: 'Lọc khách hàng theo tỉnh, thành phố. Giữ bộ lọc khi chuyển trang.',
    kind: 'code',
    status: 'todo',
  },
  {
    key: 'catalog-speed',
    project: 'web-ban-hang',
    title: 'Tối ưu tốc độ tải trang danh mục sản phẩm',
    description: 'Trang danh mục mất khoảng 4 giây mới hiện đủ ảnh.',
    kind: 'code',
    status: 'blocked',
    comments: ['Tạm dừng chờ chọn cách làm: nén ảnh sẵn khi tải lên, hay tải ảnh dần khi cuộn.'],
  },
  {
    key: 'return-policy',
    project: 'web-ban-hang',
    title: 'Cập nhật trang Chính sách đổi trả',
    description: 'Đổi thời hạn đổi trả từ 7 ngày lên 15 ngày.',
    kind: 'code',
    status: 'done',
  },
  {
    key: 'google-login',
    project: 'web-ban-hang',
    title: 'Thêm đăng nhập bằng Google',
    description: 'Tạm dừng, chờ quyết định về bảo mật tài khoản.',
    kind: 'code',
    status: 'cancelled',
  },
  {
    key: 'driver-map',
    project: 'app-giao-hang',
    title: 'Hiện bản đồ đường đi cho tài xế',
    description: 'Màn hình đơn hàng hiện bản đồ từ vị trí tài xế tới địa chỉ giao.',
    kind: 'code',
    status: 'in_progress',
    children: [{ title: 'Tích hợp API bản đồ vào màn hình đơn hàng', status: 'in_progress', slot: 'executor' }],
  },
  {
    key: 'delivered-push',
    project: 'app-giao-hang',
    title: 'Gửi thông báo khi đơn được giao thành công',
    description: 'Khách nhận thông báo đẩy kèm ảnh xác nhận giao hàng.',
    kind: 'code',
    status: 'todo',
  },
  {
    key: 'offline-crash',
    project: 'app-giao-hang',
    title: 'Sửa lỗi ứng dụng thoát khi mất mạng',
    description: 'Mở chi tiết đơn khi mất mạng thì ứng dụng thoát.',
    kind: 'code',
    status: 'done',
  },
  {
    key: 'phone-login',
    project: 'app-giao-hang',
    title: 'Thêm đăng nhập bằng số điện thoại',
    description: 'Tài xế đăng nhập bằng số điện thoại và mã OTP.',
    kind: 'code',
    status: 'backlog',
  },
];

export const GUIDE_DEMO = {
  /** Yêu cầu đang chờ owner duyệt (ảnh cửa sổ yêu cầu, nút Duyệt, Ép Done). */
  ownerIssueTitle: ISSUES[0].title,
  requestTitle: 'Đổi ảnh banner trang chủ cho chiến dịch tháng 11',
  requestBody: 'Dùng bộ ảnh mới của chiến dịch tháng 11, giữ nguyên chữ trên banner.',
  commentBody: 'Nhờ thêm cột Tổng tiền đã giảm giá vào file Excel.',
  rejectedTitle: 'Viết lại toàn bộ trang chủ bằng tiếng Anh',
  agentName: 'web-ban-hang-reviewer',
} as const;

export interface GuideCompany extends E2eCompany {
  ownerIssue: { id: string; identifier: string };
}

interface Row {
  id: string;
  name: string;
  status?: string;
  archivedAt?: string | null;
}
interface IssueRow {
  id: string;
  identifier: string;
  title: string;
  status: string;
  parentId?: string | null;
}

/** UUID ổn định theo chuỗi (machineId không đổi giữa các lượt). */
function stableUuid(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const sha40 = (seed: string) => createHash('sha1').update(seed).digest('hex');
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const checkoutOf = (key: string, slot: CrewRoleSlot) => `${HOME}/crew-agents/${key}/${slot}`;
const slotsOf = (p: ProjectSpec): CrewRoleSlot[] => [
  'assistant',
  'executor',
  ...(p.executors === 2 ? (['executor-2'] as const) : []),
  'reviewer',
  'integrator',
];

async function ensureCompany(owner: Api): Promise<{ id: string; name: string; issuePrefix: string }> {
  const all = await owner.get<{ id: string; name: string; issuePrefix: string; status: string }[]>('/api/companies');
  const found = all.find((c) => c.name === GUIDE_COMPANY_NAME && c.status === 'active');
  if (found) return found;
  return owner.post('/api/companies', {
    name: GUIDE_COMPANY_NAME,
    description: 'Company mẫu cho ảnh trang Hướng dẫn',
  });
}

async function ensureSecret(owner: Api, companyId: string, name: string): Promise<string> {
  const list = await owner.get<Row[]>(`/api/companies/${companyId}/secrets`);
  const found = list.find((s) => s.name === name);
  if (found) return found.id;
  // Giá trị ngẫu nhiên, không ai cần đọc lại: webhook dùng key máy dẫn xuất từ nó, SSH không bao giờ chạy thật.
  return (await owner.post<{ id: string }>(`/api/companies/${companyId}/secrets`, { name, value: randomUUID() })).id;
}

/** Company là company Crew khi config plugin của nó có mục `companies` trỏ secret webhook. */
async function ensurePluginConfig(owner: Api, companyId: string, webhookSecretId: string): Promise<void> {
  type Config = { companies?: { companyId: string }[] } & Record<string, unknown>;
  const current = await owner
    .get<{ configJson: Config } | null>(`${PLUGIN}/config?companyId=${companyId}`)
    .catch(() => null);
  const config = current?.configJson ?? {};
  if ((config.companies ?? []).some((c) => c.companyId === companyId)) return;
  const ref = { type: 'secret_ref', secretId: webhookSecretId, version: 'latest' };
  await owner.post(`${PLUGIN}/config`, {
    companyId,
    configJson: { ...config, companies: [...(config.companies ?? []), { companyId, webhookSecretRef: ref }] },
  });
}

interface EnvBody {
  name: string;
  description: string;
  host: string;
  remoteWorkspacePath: string;
  keySecretId: string;
}
async function ensureEnvironment(owner: Api, companyId: string, body: EnvBody): Promise<string> {
  const list = await owner.get<Row[]>(`/api/companies/${companyId}/environments`);
  const found = list.find((e) => e.name === body.name && e.status === 'active');
  if (found) return found.id;
  const created = await owner.post<{ id: string }>(`/api/companies/${companyId}/environments`, {
    name: body.name,
    description: body.description,
    driver: 'ssh',
    config: {
      host: body.host,
      port: 2222,
      username: 'crew',
      remoteWorkspacePath: body.remoteWorkspacePath,
      privateKeySecretRef: { type: 'secret_ref', secretId: body.keySecretId, version: 'latest' },
      knownHosts: `[${body.host}]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGd1aWRlZGVtb2tleWZvcnNjcmVlbnNob3RzAAA`,
      strictHostKeyChecking: true,
    },
    metadata: { workspaceRealizationMode: 'in_place' },
  });
  return created.id;
}

/** AGENTS.md theo template của fork (như wizard). Trợ Lý có thêm danh sách executor của project. */
export function instructionsOf(slot: CrewRoleSlot, executorIds: string[]): string {
  const role = roleOfSlot(slot);
  const text = readFileSync(path.join(TEMPLATES, `${role}.md`), 'utf8');
  if (role !== 'assistant') return text;
  const list = executorIds.map((id) => `- \`${id}\` — runtime \`claude_local\``).join('\n');
  return `${text.replace(/\n*$/, '\n')}\n## Executor của company\n\n${list}\n\n## Agent BMAD của company\n\nKhông có. Luôn dùng Superpowers.\n\n## Agent UIUX của company\n\nKhông có. Không tạo con thiết kế; làm như cũ.\n\n## Reviewer Codex của company\n\nKhông có. Server tự chọn reviewer, bạn không giao việc cho reviewer.\n`;
}

interface ProjectSetup {
  id: string;
  agents: Partial<Record<CrewRoleSlot, string>>;
}

async function ensureProject(
  owner: Api,
  companyId: string,
  spec: ProjectSpec,
  host: string,
  keySecretId: string,
): Promise<ProjectSetup> {
  const projects = await owner.get<Row[]>(`/api/companies/${companyId}/projects`);
  const project =
    projects.find((p) => p.name === spec.name && !p.archivedAt) ??
    (await owner.post<Row>(`/api/companies/${companyId}/projects`, {
      name: spec.name,
      description: spec.description,
      color: spec.color,
    }));
  const agents = await owner.get<(Row & { defaultEnvironmentId?: string | null })[]>(
    `/api/companies/${companyId}/agents`,
  );
  const ids: Partial<Record<CrewRoleSlot, string>> = {};
  const settings = await loadModelSettings(owner);
  for (const slot of slotsOf(spec)) {
    const name = `${spec.key}-${slot}`;
    const environmentId = await ensureEnvironment(owner, companyId, {
      name,
      description: `Vai trò ${slot} của project ${spec.name}`,
      host,
      remoteWorkspacePath: checkoutOf(spec.key, slot),
      keySecretId,
    });
    const found = agents.find((a) => a.name === name && a.status !== 'terminated');
    if (found) {
      ids[slot] = found.id;
      continue;
    }
    const body = crewAgentCreateBody({
      name,
      slot,
      model: defaultModelOf(slot, settings),
      settings,
      pinDir: PIN_DIR,
      environmentId,
    });
    // Agent mẫu không bao giờ chạy: tắt đánh thức theo yêu cầu (giao việc, bình luận) để không có run lỗi.
    const created = await owner.post<{ id: string }>(`/api/companies/${companyId}/agents`, {
      ...body,
      runtimeConfig: { heartbeat: { ...body.runtimeConfig.heartbeat, wakeOnDemand: false } },
    });
    await owner.patch(`/api/agents/${created.id}/permissions?companyId=${companyId}`, {
      ...CREW_AGENT_PERMISSIONS,
      canAssignTasks: slot === 'assistant',
    });
    ids[slot] = created.id;
  }
  const executorIds = slotsOf(spec)
    .filter((s) => roleOfSlot(s) === 'executor')
    .map((s) => ids[s] as string);
  for (const slot of slotsOf(spec)) {
    const agentId = ids[slot] as string;
    const existing = await owner.raw(
      'GET',
      `/api/agents/${agentId}/instructions-bundle/file?path=AGENTS.md&companyId=${companyId}`,
    );
    if (existing.status === 200) continue;
    await owner.put(`/api/agents/${agentId}/instructions-bundle/file?companyId=${companyId}`, {
      path: 'AGENTS.md',
      content: instructionsOf(slot, executorIds),
    });
  }
  await owner.post(`${PLUGIN}/api/projects/${project.id}/roles`, {
    companyId,
    assistantAgentId: ids.assistant,
    executorAgentIds: executorIds,
    reviewerAgentId: ids.reviewer,
    integratorAgentId: ids.integrator,
  });
  return { id: project.id, agents: ids };
}

/** Ghép (hoặc xoay key của) máy rồi trả key máy để ký bản tin. */
async function pairMachine(
  owner: Api,
  companyId: string,
  m: MachineSpec,
  environmentId: string,
): Promise<{ machineId: string; key: string }> {
  const machineId = stableUuid(`${companyId}/${m.hostname}`);
  const paired = await owner.post<{ machineKey: string }>(`${PLUGIN}/api/machines/pair`, {
    companyId,
    machineId,
    hostname: m.hostname,
    environmentId,
    tailscaleIp: m.ip,
    port: 2222,
    hostKeyFingerprint: `SHA256:${createHash('sha256').update(m.hostname).digest('base64').slice(0, 43)}`,
  });
  return { machineId, key: paired.machineKey };
}

async function sendSigned(owner: Api, endpoint: string, key: string, body: unknown): Promise<void> {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `sha256=${createHmac('sha256', key).update(timestamp).update('.').update(raw).digest('hex')}`;
  const res = await owner.ctx.fetch(`${PLUGIN}/webhooks/${endpoint}`, {
    method: 'POST',
    data: raw,
    headers: { 'content-type': 'application/json', 'x-crew-timestamp': timestamp, 'x-crew-signature': signature },
  });
  if (res.status() >= 300) throw new Error(`Webhook ${endpoint} trả HTTP ${res.status()}`);
}

function machineReport(companyId: string, machineId: string, m: MachineSpec, checkouts: string[]) {
  return {
    version: 1,
    companyId,
    machineId,
    hostname: m.hostname,
    sentAt: new Date().toISOString(),
    load1: m.load1,
    cpuCount: 10,
    memFreePct: m.memFreePct,
    tccPending: [],
    claude: { version: '2.1.294', loggedIn: true, plan: 'max' },
    superpowers: { pinned: '6.4.1', ownerInstalled: '6.4.1', pinDir: PIN_DIR },
    checks: [{ id: 'sshd-agent', status: 'ok', title: 'sshd của agent đang chạy' }],
    app: { version: '3.5.0', sshdOwner: 'app', updateState: 'idle' },
    checkouts: checkouts.map((p) => ({ path: p, head: sha40(p), clean: true })),
    runtimes: {
      codex: { version: '0.45.0', loggedIn: true, primaryUsedPct: 12, resetsAt: null },
      opencode: {
        version: '1.4.2',
        keyPresent: true,
        costDay: 0.8,
        costWeek: 4.2,
        costMonth: 11.5,
        models: ['opencode-go/kimi-k3', 'opencode-go/glm-5.3'],
      },
    },
  };
}

const DOC_PAGES: { path: string; title: string; text: string }[] = [
  {
    path: 'docs/index.md',
    title: 'Tài liệu Website bán hàng',
    text: '# Tài liệu Website bán hàng\n\nĐọc trước: [Luồng thanh toán](flows/thanh-toan.md), [Phí vận chuyển](flows/phi-van-chuyen.md).\n',
  },
  {
    path: 'docs/flows/thanh-toan.md',
    title: 'Luồng thanh toán',
    text: '# Luồng thanh toán\n\n1. Khách chọn cổng thanh toán.\n2. Cổng gọi lại `/api/payments/callback`.\n3. Đơn chuyển sang **Đã thanh toán**.\n',
  },
  {
    path: 'docs/flows/phi-van-chuyen.md',
    title: 'Phí vận chuyển',
    text: '# Phí vận chuyển\n\n| Cân nặng | Phí |\n|---|---|\n| Tới 1 kg | 20.000 đ |\n| Mỗi 0,5 kg tiếp theo | 5.000 đ |\n',
  },
  {
    path: 'docs/huong-dan/xuat-bao-cao.md',
    title: 'Xuất báo cáo doanh thu',
    text: '# Xuất báo cáo doanh thu\n\nVào **Báo cáo doanh thu**, chọn khoảng ngày rồi bấm **Xuất Excel**.\n',
  },
];

function docsSnapshot(companyId: string, projectId: string, machineId: string) {
  const pages = DOC_PAGES.map((p) => ({
    ...p,
    parentPath: p.path.slice(0, p.path.lastIndexOf('/')),
    sha256: sha256(p.text),
  }));
  return {
    version: 1,
    companyId,
    projectId,
    machineId,
    repo: 'web-ban-hang',
    commit: sha40('web-ban-hang/main'),
    auditState: 'verified',
    checkExit: 0,
    pages,
    links: [
      {
        fromPath: 'docs/index.md',
        occurrence: 1,
        originalHref: 'flows/thanh-toan.md',
        toPath: 'docs/flows/thanh-toan.md',
        fragment: null,
        status: 'ok',
      },
      {
        fromPath: 'docs/index.md',
        occurrence: 2,
        originalHref: 'flows/phi-van-chuyen.md',
        toPath: 'docs/flows/phi-van-chuyen.md',
        fragment: null,
        status: 'ok',
      },
    ],
    dropped: [],
  };
}

async function ensureResearchLabel(owner: Api, companyId: string): Promise<string> {
  const labels = await owner.get<Row[]>(`/api/companies/${companyId}/labels`);
  const found = labels.find((l) => l.name === 'research');
  if (found) return found.id;
  return (
    await owner.post<{ id: string }>(`/api/companies/${companyId}/labels`, { name: 'research', color: '#6366f1' })
  ).id;
}

function policyOf(kind: 'code' | 'research', agents: Partial<Record<CrewRoleSlot, string>>, ownerUserId: string) {
  const review = (id: string | undefined) => ({
    type: 'review',
    approvalsNeeded: 1,
    participants: [{ type: 'agent', agentId: id }],
  });
  const approval = { type: 'approval', approvalsNeeded: 1, participants: [{ type: 'user', userId: ownerUserId }] };
  const stages =
    kind === 'research'
      ? [review(agents.reviewer), approval]
      : [review(agents.reviewer), review(agents.integrator), approval, review(agents.integrator)];
  return { mode: 'normal', commentRequired: true, maxReviewRounds: 5, stages };
}

/**
 * Đưa yêu cầu tới trạng thái mong muốn bằng quyền board. Yêu cầu có quy trình duyệt thì lần "done" đầu đưa vào bước
 * duyệt; lần thứ hai (board) đóng hẳn.
 */
async function setStatus(api: Api, issueId: string, status: Status): Promise<void> {
  if (status === 'todo') return;
  if (status === 'backlog' || status === 'cancelled') {
    await api.patch(`/api/issues/${issueId}`, { status });
    return;
  }
  await api.patch(`/api/issues/${issueId}`, { status: 'in_progress' });
  if (status === 'in_progress') return;
  if (status === 'blocked') {
    await api.patch(`/api/issues/${issueId}`, {
      status,
      unblockDescriptor: { owner: 'board', action: 'Chọn cách tải ảnh: nén sẵn khi tải lên hay tải dần khi cuộn' },
    });
    return;
  }
  for (let i = 0; i < 2; i++) {
    const moved = await api.patch<IssueRow>(`/api/issues/${issueId}`, { status: 'done', comment: 'Đã xong.' });
    if (moved.status === 'done') return;
  }
}

async function ensureIssues(owner: Api, companyId: string, projects: Record<string, ProjectSetup>): Promise<IssueRow> {
  const me = (await owner.get<{ user: { id: string } }>('/api/auth/get-session')).user.id;
  const researchLabel = await ensureResearchLabel(owner, companyId);
  const existing = await owner.get<IssueRow[]>(`/api/companies/${companyId}/issues?limit=500`);
  let ownerIssue: IssueRow | undefined;
  for (const spec of ISSUES) {
    const project = projects[spec.project];
    const found = existing.find((i) => i.title === spec.title && !i.parentId);
    if (found) {
      if (spec.stage === 'owner') {
        // Lần chụp trước không bao giờ bấm Duyệt; nếu ai đó đã duyệt thì đưa yêu cầu về lại bước chờ owner.
        if (found.status !== 'in_review') {
          await owner.patch(`/api/issues/${found.id}`, { status: 'in_progress' });
          await owner.patch(`/api/issues/${found.id}`, { status: 'done', comment: 'Làm lại, mời duyệt lần nữa.' });
        }
        ownerIssue = await owner.get<IssueRow>(`/api/issues/${found.id}`);
      } else if (!spec.stage && found.status !== spec.status) {
        // Lượt trước dừng giữa chừng: đưa nốt về trạng thái mong muốn.
        await setStatus(owner, found.id, spec.status);
      }
      continue;
    }
    const executionPolicy =
      spec.stage === 'owner'
        ? {
            mode: 'normal',
            commentRequired: true,
            maxReviewRounds: 5,
            stages: [{ type: 'approval', approvalsNeeded: 1, participants: [{ type: 'user', userId: me }] }],
          }
        : policyOf(spec.kind, project.agents, me);
    const root = await owner.post<IssueRow>(`/api/companies/${companyId}/issues`, {
      title: spec.title,
      description: spec.description,
      projectId: project.id,
      assigneeAgentId: project.agents.assistant,
      status: 'todo',
      executionPolicy,
      ...(spec.kind === 'research' ? { labelIds: [researchLabel] } : {}),
    });
    for (const child of spec.children ?? []) {
      const c = await owner.post<IssueRow>(`/api/companies/${companyId}/issues`, {
        title: child.title,
        projectId: project.id,
        parentId: root.id,
        assigneeAgentId: project.agents[child.slot],
        status: 'todo',
      });
      await setStatus(owner, c.id, child.status);
    }
    for (const body of spec.comments ?? []) await owner.post(`/api/issues/${root.id}/comments`, { body });
    if (spec.stage) {
      // Xong phần làm: yêu cầu vào bước duyệt đầu tiên (Reviewer, hoặc owner với yêu cầu chờ duyệt).
      await owner.patch(`/api/issues/${root.id}`, { status: 'in_progress' });
      const moved = await owner.patch<IssueRow>(`/api/issues/${root.id}`, {
        status: 'done',
        comment: 'Mọi việc con đã xong, mời duyệt.',
      });
      if (moved.status !== 'in_review') throw new Error(`${spec.title} không vào bước duyệt: ${moved.status}`);
      if (spec.stage === 'owner') ownerIssue = moved;
    } else {
      await setStatus(owner, root.id, spec.status);
    }
  }
  if (!ownerIssue) throw new Error('Thiếu yêu cầu mẫu ở bước Owner duyệt');
  return ownerIssue;
}

interface Contribution {
  id: string;
  kind: 'issue' | 'comment';
  status: string;
  title: string | null;
  targetIssueId: string | null;
}

async function ensureContributions(owner: Api, guest: Api, companyId: string, projectId: string, issueId: string) {
  const route = `/api/crew/companies/${companyId}/contributions`;
  const page = async (status: string) =>
    (await guest.get<{ items: Contribution[] }>(`${route}?status=${status}`)).items;
  const mine = [...(await page('pending')), ...(await page('rejected'))];
  const has = (pred: (c: Contribution) => boolean) => mine.some(pred);
  if (!has((c) => c.kind === 'issue' && c.title === GUIDE_DEMO.requestTitle)) {
    await guest.post(route, {
      kind: 'issue',
      projectId,
      title: GUIDE_DEMO.requestTitle,
      description: GUIDE_DEMO.requestBody,
    });
  }
  if (!has((c) => c.kind === 'comment' && c.targetIssueId === issueId)) {
    await guest.post(route, { kind: 'comment', issueId, body: GUIDE_DEMO.commentBody });
  }
  if (!has((c) => c.kind === 'issue' && c.title === GUIDE_DEMO.rejectedTitle)) {
    const made = await guest.post<Contribution>(route, { kind: 'issue', projectId, title: GUIDE_DEMO.rejectedTitle });
    await owner.post(`${route}/${made.id}/reject`, {});
  }
}

/**
 * Thêm company mẫu vào file chính sách Crew của server T1 (`CREW_POLICY_CONFIG`, server đọc lại mỗi lần gọi): route góp
 * ý và luật Crew chỉ chạy cho company có trong file này. Đường file truyền qua `CREW_GUIDE_POLICY_FILE`.
 */
function ensurePolicyEntry(
  companyId: string,
  entry: { reviewerAgentId: string; integratorAgentId: string; ownerUserId: string },
) {
  const file = process.env.CREW_GUIDE_POLICY_FILE;
  if (!file) throw new Error('Thiếu CREW_GUIDE_POLICY_FILE (file CREW_POLICY_CONFIG của server T1)');
  const config = JSON.parse(readFileSync(file, 'utf8')) as { companies: Record<string, unknown> };
  const current = config.companies[companyId] as Record<string, unknown> | undefined;
  if (current && Object.entries(entry).every(([k, v]) => current[k] === v)) return;
  config.companies[companyId] = { ...(current ?? {}), ...entry };
  writeFileSync(file, JSON.stringify(config));
}

export interface GuideCompanyBase extends E2eCompany {
  projects: Record<string, ProjectSetup>;
  keySecretId: string;
}

/**
 * Tìm hoặc tạo company mẫu, bật Crew cho nó (config plugin và file chính sách), dựng hai project có vai trò đủ. Người
 * tạo (phiên board) là owner.
 */
export async function ensureGuideCompany(owner: Api): Promise<GuideCompanyBase> {
  if (isProd()) throw new Error('Company mẫu của ảnh hướng dẫn chỉ dựng trên stack T1');
  const c = await ensureCompany(owner);
  const webhookSecretId = await ensureSecret(owner, c.id, 'crew-webhook');
  const keySecretId = await ensureSecret(owner, c.id, 'crew-agent-ssh-key');
  await ensurePluginConfig(owner, c.id, webhookSecretId);
  const projects: Record<string, ProjectSetup> = {};
  for (const spec of GUIDE_PROJECTS) {
    projects[spec.key] = await ensureProject(owner, c.id, spec, MACHINES[0].ip, keySecretId);
  }
  const main = projects[GUIDE_PROJECTS[0].key];
  const me = (await owner.get<{ user: { id: string } }>('/api/auth/get-session')).user.id;
  ensurePolicyEntry(c.id, {
    reviewerAgentId: main.agents.reviewer as string,
    integratorAgentId: main.agents.integrator as string,
    ownerUserId: me,
  });
  return {
    ...c,
    projects,
    keySecretId,
    path: (to = '') => `/${c.issuePrefix}${to ? `/${to.replace(/^\//, '')}` : ''}`,
  };
}

/**
 * Dựng yêu cầu và góp ý mẫu nếu chưa có, rồi làm mới bản tin máy và docs. `guest` là phiên Phòng Marketing đã là
 * thành viên company (gọi `ensureGuideMembers` trước).
 */
export async function seedGuideCompany(owner: Api, guest: Api, company: GuideCompanyBase): Promise<GuideCompany> {
  const { projects, keySecretId } = company;
  const ownerIssue = await ensureIssues(owner, company.id, projects);
  await ensureContributions(owner, guest, company.id, projects['web-ban-hang'].id, ownerIssue.id);

  const checkouts = GUIDE_PROJECTS.flatMap((p) => slotsOf(p).map((s) => checkoutOf(p.key, s)));
  for (const [i, m] of MACHINES.entries()) {
    const environmentId = await ensureEnvironment(owner, company.id, {
      name: `may-${m.hostname}`,
      description: `Máy ${m.hostname}`,
      host: m.ip,
      remoteWorkspacePath: `${HOME}/crew-agents`,
      keySecretId,
    });
    const { machineId, key } = await pairMachine(owner, company.id, m, environmentId);
    await sendSigned(owner, 'machine-status', key, machineReport(company.id, machineId, m, i === 0 ? checkouts : []));
    if (i === 0) {
      await sendSigned(owner, 'docs-snapshot', key, docsSnapshot(company.id, projects['web-ban-hang'].id, machineId));
    }
  }
  return { ...company, ownerIssue: { id: ownerIssue.id, identifier: ownerIssue.identifier } };
}
