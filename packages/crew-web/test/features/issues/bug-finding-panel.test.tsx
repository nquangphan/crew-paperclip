// @vitest-environment jsdom
import type { BugFindingFinding, BugFindingRunView, BugFindingView } from '@crew/paperclip-plugin/shared/bug-finding';
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  BugFindingApprovalCard,
  BugFindingPanel,
  BugFindingSection,
} from '@/features/issues/detail/crew/bug-finding-panel';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { mount } from './detail-fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const HEAD1 = `a71d02c9e5f1${'0'.repeat(28)}`;
const HEAD2 = `3f9c1e07a2b4${'0'.repeat(28)}`;

function finding(
  id: string,
  severity: string,
  title: string,
  over: Partial<BugFindingFinding> = {},
): BugFindingFinding {
  return {
    id,
    rule: null,
    title,
    severity,
    certainty: 'Confirmed',
    status: 'OPEN',
    action: 'CODE_FIX',
    mr_relation: 'introduced',
    location: 'src/date-filter.ts:57',
    fix: null,
    accept: null,
    question: null,
    ...over,
  };
}

function run(over: Partial<BugFindingRunView>): BugFindingRunView {
  return {
    id: 'r1',
    companyId: 'c1',
    issueId: 'i-root',
    approvalRound: 0,
    run: 1,
    requestId: 'q1',
    machineJobId: null,
    machineId: 'm1',
    headSha: HEAD1,
    prUrl: 'https://github.com/nquangphan/crew/pull/87',
    state: 'succeeded',
    verdict: 'BLOCK',
    lanesDone: 7,
    lanesTotal: 7,
    findings: [],
    feedbackText: null,
    reportDocumentKey: 'bug-finding-round-0-run-1',
    costUsd: 1.84,
    error: null,
    createdAt: '2026-11-04T01:00:00.000Z',
    startedAt: '2026-11-04T01:01:00.000Z',
    finishedAt: '2026-11-04T01:35:00.000Z',
    triage: null,
    ...over,
  };
}

const FIRST = run({
  findings: [
    finding('F-01', 'HIGH', 'Lọc ngày dùng giờ máy'),
    finding('F-02', 'MEDIUM', 'Thiếu test ngày cuối tháng', { action: 'TEST_FIX' }),
    finding('F-04', 'LOW', 'Không giới hạn khoảng ngày', {
      certainty: 'Needs-Clarification',
      question: 'Có cần giới hạn 12 tháng?',
    }),
    finding('F-05', 'LOW', 'Tên biến viết tắt', { mr_relation: 'pre_existing' }),
  ],
  triage: {
    run: 1,
    batch: 1,
    fix: ['F-01', 'F-02'],
    ask: ['F-04'],
    dismiss: ['F-05'],
    createdAt: '2026-11-04T01:40:00.000Z',
    reasons: { 'F-05': 'Có từ trước PR này, ngoài phạm vi yêu cầu.' },
    fixIssues: {
      'F-01': [{ id: 'c1', identifier: 'TPS-651', status: 'done' }],
      'F-02': [{ id: 'c2', identifier: 'TPS-652', status: 'in_review' }],
    },
  },
});
const RUNNING = run({
  id: 'r2',
  run: 2,
  requestId: 'q2',
  headSha: HEAD2,
  state: 'running',
  verdict: null,
  lanesDone: 4,
  lanesTotal: 7,
  findings: null,
  reportDocumentKey: null,
  costUsd: null,
  createdAt: '2026-11-04T03:00:00.000Z',
  finishedAt: null,
});
const view = (runs: BugFindingRunView[], batchesUsed = 1): BugFindingView => ({
  runs,
  batchesUsed,
  maxBatches: 2,
  currentHead: runs[0]?.headSha ?? null,
  approvalRound: 0,
});

describe('BugFindingPanel', () => {
  it('lượt đang chạy có thanh tiến độ lane và số lô sửa đã dùng', () => {
    mount(<BugFindingPanel view={view([RUNNING, FIRST])} />);
    const card = screen.getByRole('region', { name: 'Bug Finding lượt 2' });
    const bar = within(card).getByRole('progressbar', { name: 'Tiến độ lane' });
    expect(bar.getAttribute('aria-valuenow')).toBe('4');
    expect(bar.getAttribute('aria-valuemax')).toBe('7');
    expect(within(card).getByText('4/7 lane xong')).toBeTruthy();
    expect(within(card).getByText('Đang chạy')).toBeTruthy();
    expect(within(card).getByText(/3f9c1e07a2b4/)).toBeTruthy();
    expect(screen.getByText('Lô sửa tự động: 1 / tối đa 2')).toBeTruthy();
  });

  it('lượt xong chia ba nhóm theo kế hoạch của Trợ Lý, kèm việc con sửa và lý do bỏ qua', () => {
    mount(<BugFindingPanel view={view([RUNNING, FIRST])} />);
    const card = screen.getByRole('region', { name: 'Bug Finding lượt 1' });
    expect(within(card).getByText('BLOCK')).toBeTruthy();
    const fix = within(card).getByRole('table', { name: 'Trợ Lý tự sửa (2)' });
    expect(within(fix).getByText('Lọc ngày dùng giờ máy')).toBeTruthy();
    expect(within(fix).getByText('TPS-651')).toBeTruthy();
    expect(within(fix).getByText('TPS-652')).toBeTruthy();
    const ask = within(card).getByRole('table', { name: 'Cần owner chốt (1)' });
    expect(within(ask).getByText('Có cần giới hạn 12 tháng?')).toBeTruthy();
    const dismiss = within(card).getByRole('table', { name: 'Trợ Lý bỏ qua (1)' });
    expect(within(dismiss).getByText('Có từ trước PR này, ngoài phạm vi yêu cầu.')).toBeTruthy();
    expect(within(card).queryByText('Trợ Lý chưa phân loại finding của lượt này.')).toBeNull();
  });

  it('lượt xong chưa có kế hoạch thì hiện bảng finding và báo chưa phân loại', () => {
    mount(<BugFindingPanel view={view([run({ findings: FIRST.findings, triage: null })], 0)} />);
    expect(screen.getByText('Trợ Lý chưa phân loại finding của lượt này.')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Finding (4)' })).toBeTruthy();
  });

  it('lượt hỏng hiện lý do', () => {
    mount(
      <BugFindingPanel
        view={view([run({ state: 'timeout', verdict: null, error: 'Máy chưa nhận việc sau 30 phút' })], 0)}
      />,
    );
    expect(screen.getByText('Hết giờ')).toBeTruthy();
    expect(screen.getByText('Máy chưa nhận việc sau 30 phút')).toBeTruthy();
  });
});

describe('BugFindingApprovalCard', () => {
  it('kết quả cuối trên đúng commit sẽ merge và bảng finding của lượt cuối', () => {
    const last = run({
      id: 'r3',
      run: 2,
      requestId: 'q3',
      headSha: HEAD2,
      verdict: 'APPROVE',
      costUsd: 0.96,
      createdAt: '2026-11-04T03:00:00.000Z',
      findings: [finding('F-01', 'HIGH', 'Lọc ngày dùng giờ máy', { status: 'FIX_VERIFIED' })],
    });
    mount(<BugFindingApprovalCard view={view([last, FIRST])} />);
    const card = screen.getByRole('region', { name: 'Bug Finding' });
    expect(within(card).getByText('APPROVE')).toBeTruthy();
    expect(within(card).getByText(/lượt 2 trên 3f9c1e07a2b4 \(đúng commit sẽ merge\)/)).toBeTruthy();
    expect(within(card).getByText('FIX_VERIFIED')).toBeTruthy();
    expect(within(card).getByText('Trợ Lý sửa · TPS-651')).toBeTruthy();
  });
});

describe('BugFindingSection', () => {
  it('đọc GET …/issues/:id/bug-finding kèm companyId', async () => {
    const s = mockServer({
      'GET /api/plugins/crew.core/api/issues/i-root/bug-finding': { body: view([RUNNING, FIRST]) },
    });
    mount(<BugFindingSection companyId="c1" issueId="i-root" />);
    expect(await screen.findByText('4/7 lane xong')).toBeTruthy();
    expect(s.calls[0]?.url).toBe('/api/plugins/crew.core/api/issues/i-root/bug-finding?companyId=c1');
  });
});
