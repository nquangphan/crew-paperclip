// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  formatRunDuration,
  modelLabel,
  type RoadmapNode,
  type RoadmapRun,
  roadmapNodeSize,
  roadmapRuns,
  runTone,
  shortAgentName,
} from '@/ds';
import { RoadmapNodeButton } from '@/ds/widgets/roadmap/roadmap-node';
import { initI18n, setLanguage } from '@/i18n';

beforeAll(async () => {
  await initI18n();
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await setLanguage('vi');
});

describe('định dạng dòng run', () => {
  it('rút gọn tên agent bằng cách bỏ tiền tố project', () => {
    expect(shortAgentName('my-money-executor-1')).toBe('executor-1');
    expect(shortAgentName('my-money-reviewer')).toBe('reviewer');
    expect(shortAgentName('kidy_school_integrator')).toBe('integrator');
    expect(shortAgentName('CEO')).toBe('CEO');
  });

  it('dịch mã model thành nhãn ngắn', () => {
    expect(modelLabel('claude-sonnet-5')).toBe('Sonnet 5');
    expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet 5.5');
    expect(modelLabel('claude-opus-5')).toBe('Opus 5');
    expect(modelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5');
    expect(modelLabel('claude-opus-4-1-20250805')).toBe('Opus 4.1');
    expect(modelLabel('claude-sonnet-4-20250514')).toBe('Sonnet 4');
    expect(modelLabel('claude-3-5-haiku-20241022')).toBe('Haiku 3.5');
    expect(modelLabel('claude-haiku-4-5')).toBe('Haiku 4.5');
    expect(modelLabel('anthropic/claude-haiku')).toBe('Haiku');
    expect(modelLabel('opencode-go/kimi-k2')).toBe('kimi-k2');
    expect(modelLabel(null)).toBeNull();
    expect(modelLabel('  ')).toBeNull();
  });

  it('thời lượng gọn, run đang chạy tính tới hiện tại', () => {
    const start = '2026-10-21T01:00:00.000Z';
    expect(formatRunDuration(start, '2026-10-21T01:00:45.000Z', 0)).toBe('45s');
    expect(formatRunDuration(start, '2026-10-21T01:12:30.000Z', 0)).toBe('12m');
    expect(formatRunDuration(start, '2026-10-21T02:05:00.000Z', 0)).toBe('1h05m');
    expect(formatRunDuration(start, null, Date.parse('2026-10-21T01:03:00.000Z'))).toBe('3m');
    expect(formatRunDuration(null, null, 0)).toBeNull();
    expect(formatRunDuration('hỏng', null, 0)).toBeNull();
  });

  it('nhóm màu trạng thái run', () => {
    expect(['running', 'queued', 'succeeded', 'failed', 'timed_out', 'cancelled', 'interrupted'].map(runTone)).toEqual([
      'running',
      'queued',
      'succeeded',
      'failed',
      'failed',
      'cancelled',
      'cancelled',
    ]);
  });

  it('dựng run của thẻ: gốc lấy tổng cả cây, không có run nào thì không có khối run', () => {
    const own = { runs: [], count: 0, costUsd: null, subscription: false };
    expect(roadmapRuns(undefined)).toBeUndefined();
    expect(roadmapRuns(own)).toBeUndefined();
    expect(roadmapRuns(undefined, { count: 4, costUsd: 2.5, subscription: true })).toEqual({
      runs: [],
      count: 0,
      total: { count: 4, costUsd: 2.5, subscription: true, tree: true },
    });
  });
});

const NOW = Date.parse('2026-10-21T05:00:00.000Z');
const run = (i: number, over: Partial<RoadmapRun> = {}): RoadmapRun => ({
  id: `run-${i}`,
  status: 'succeeded',
  agentName: 'my-money-executor-1',
  model: 'claude-sonnet-5',
  startedAt: new Date(NOW - (i + 1) * 3_600_000).toISOString(),
  finishedAt: new Date(NOW - (i + 1) * 3_600_000 + 12 * 60_000).toISOString(),
  costUsd: 0.83,
  ...over,
});

function ticket(runs: RoadmapRun[], count = runs.length): RoadmapNode {
  return {
    id: 't',
    kind: 'ticket',
    title: 'Gọi API duyệt phiên',
    identifier: 'TPS-44',
    status: 'in_progress',
    runs: { runs, count, total: { count, costUsd: 4.15, subscription: true, tree: false } },
  };
}

describe('khối run trên thẻ', () => {
  it('hiện tối đa 3 dòng mới nhất và "+N run", chân thẻ là tổng tiền và số run', () => {
    const runs = [run(0, { status: 'running', finishedAt: null, costUsd: null }), run(1), run(2), run(3), run(4)];
    const node = ticket(runs, 6);
    const { container } = render(<RoadmapNodeButton node={node} center={false} onActivate={() => {}} />);
    const lines = container.querySelectorAll('[data-slot="roadmap-run"]');
    expect(lines).toHaveLength(3);
    expect(lines[0].getAttribute('data-run-status')).toBe('running');
    expect(lines[1].textContent).toContain('executor-1');
    expect(lines[1].textContent).toContain('Sonnet 5');
    expect(lines[1].textContent).toContain('12m');
    expect(lines[1].textContent).toContain('$0,83');
    expect(lines[0].textContent).toContain('—');
    const total = container.querySelector('[data-slot="roadmap-runs-total"]');
    expect(total?.textContent).toContain('+3 run');
    expect(total?.textContent).toContain('$4,15 · 6 run');
    expect(total?.querySelector('[title]')?.getAttribute('title')).toBe(
      'Giá quy đổi API, gói thuê bao không bị trừ tiền',
    );
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-label')).toContain('6 run, tổng $4,15');
    expect(button.getAttribute('aria-label')).toContain('gói thuê bao không bị trừ tiền');
    // Chiều cao thẻ đúng như bố cục tính, để cây trên xuống không chồng thẻ.
    expect(button.style.height).toBe(`${roadmapNodeSize(node, false).h}px`);
  });

  it('ít run thì không có "+N", thẻ thấp hơn', () => {
    const one = ticket([run(0)]);
    const { container } = render(<RoadmapNodeButton node={one} center={false} onActivate={() => {}} />);
    expect(container.querySelectorAll('[data-slot="roadmap-run"]')).toHaveLength(1);
    expect(container.querySelector('[data-slot="roadmap-runs-total"]')?.textContent).not.toContain('+');
    expect(roadmapNodeSize(one, false).h).toBeLessThan(roadmapNodeSize(ticket([run(0), run(1), run(2)]), false).h);
    const bare: RoadmapNode = { ...one, runs: undefined };
    expect(roadmapNodeSize(bare, false).h).toBeLessThan(roadmapNodeSize(one, false).h);
  });

  it('run đang chạy: thời lượng tự tăng mỗi 30 giây ở client', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const live = run(0, { status: 'running', startedAt: new Date(NOW - 5 * 60_000).toISOString(), finishedAt: null });
    const { container } = render(<RoadmapNodeButton node={ticket([live])} center={false} onActivate={() => {}} />);
    const line = () => container.querySelector('[data-slot="roadmap-run"]')?.textContent ?? '';
    expect(line()).toContain('5m');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(line()).toContain('6m');
  });
});
