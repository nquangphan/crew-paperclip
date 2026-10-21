// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RoadmapCanvas, type RoadmapLevel } from '@/ds';
import { initI18n } from '@/i18n';

// xyflow chỉ vẽ cạnh khi nút đã đo xong: ResizeObserver giả gọi lại ngay, mọi phần tử có kích thước cố định.
beforeAll(async () => {
  class ResizeObserverStub {
    constructor(
      private readonly cb: (entries: { target: Element; contentRect: { width: number; height: number } }[]) => void,
    ) {}
    observe(el: Element) {
      queueMicrotask(() => this.cb([{ target: el, contentRect: { width: 200, height: 80 } }]));
    }
    unobserve() {}
    disconnect() {}
  }
  class DOMMatrixStub {
    m22 = 1;
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('DOMMatrixReadOnly', DOMMatrixStub);
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 200 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 80 });
  await initI18n();
});
afterEach(() => {
  cleanup();
});

const LEVEL: RoadmapLevel = {
  center: { id: 'r', kind: 'request', title: 'Gốc', identifier: 'TPS-1', status: 'in_progress', total: 3, done: 1 },
  nodes: [
    { id: 'a', kind: 'ticket', title: 'Đang làm', identifier: 'TPS-2', status: 'in_progress', parentId: 'r' },
    { id: 'b', kind: 'ticket', title: 'Xong', identifier: 'TPS-3', status: 'done', parentId: 'r' },
    { id: 'c', kind: 'ticket', title: 'Chờ', identifier: 'TPS-4', status: 'todo', parentId: 'r' },
  ],
  edges: [
    { id: 'r->a', source: 'r', target: 'a', kind: 'parent' },
    { id: 'r->b', source: 'r', target: 'b', kind: 'parent' },
    { id: 'r->c', source: 'r', target: 'c', kind: 'parent' },
    { id: 'a=>c', source: 'a', target: 'c', kind: 'blocks' },
    { id: 'b=>c', source: 'b', target: 'c', kind: 'blocks' },
  ],
  overflow: 0,
  layout: 'top-down',
};

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

async function renderEdges() {
  const { container } = render(
    <RoadmapCanvas level={LEVEL} levelKey="r" direction="none" onOpen={() => {}} labels={{ canvas: 'Bản đồ' }} />,
  );
  await screen.findByText('Gốc');
  const canvas = container.querySelector('[data-slot="roadmap-canvas"]') as HTMLElement;
  await waitFor(() => expect(canvas.querySelectorAll('path[data-edge-kind]')).toHaveLength(LEVEL.edges.length));
  const edge = (id: string) => canvas.querySelector(`path[id="${id}"]`) as SVGPathElement;
  return { canvas, edge };
}

describe('dây nối của bản đồ', () => {
  it('cạnh tới việc đang làm (và cạnh chặn có một đầu đang làm) được đánh dấu chạy, có lớp dòng chảy', async () => {
    stubReducedMotion(false);
    const { canvas, edge } = await renderEdges();
    expect(edge('r->a').dataset.running).toBe('true');
    expect(edge('a=>c').dataset.running).toBe('true');
    // Gốc đang làm không tự làm dây xuống con khác chạy theo.
    expect(edge('r->b').hasAttribute('data-running')).toBe(false);
    expect(edge('r->c').hasAttribute('data-running')).toBe(false);
    expect(edge('b=>c').hasAttribute('data-running')).toBe(false);
    // Mỗi dây chạy: một lớp vạch chạy và một hạt sáng (pathLength 100), cùng đường với dây.
    const flows = [...canvas.querySelectorAll<SVGPathElement>('path[data-edge-flow]')];
    expect(flows).toHaveLength(4);
    expect(flows.map((p) => p.getAttribute('d'))).toContain(edge('r->a').getAttribute('d'));
    const sparks = [...canvas.querySelectorAll('path.roadmap-edge-spark')];
    expect(sparks.map((p) => p.getAttribute('pathLength'))).toEqual(['100', '100']);
  });

  it('dây cha-con của cây trên xuống là đường cong từ đáy thẻ cha tới đỉnh thẻ con', async () => {
    stubReducedMotion(false);
    const { edge } = await renderEdges();
    expect(edge('r->b').getAttribute('d')).toMatch(/^M [-\d.]+,[-\d.]+ C /);
  });

  it('prefers-reduced-motion: bỏ lớp chạy, dây vẫn giữ dấu (màu) đang chạy', async () => {
    stubReducedMotion(true);
    const { canvas, edge } = await renderEdges();
    expect(edge('r->a').dataset.running).toBe('true');
    expect(canvas.querySelectorAll('path[data-edge-flow]')).toHaveLength(0);
  });
});
