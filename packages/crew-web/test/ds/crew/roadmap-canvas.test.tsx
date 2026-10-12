// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RoadmapCanvas, type RoadmapLevel, RoadmapList } from '@/ds';
import { initI18n, setLanguage } from '@/i18n';

// xyflow đo node bằng ResizeObserver và DOMMatrixReadOnly, jsdom không có.
beforeAll(async () => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  class DOMMatrixStub {
    m22 = 1;
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('DOMMatrixReadOnly', DOMMatrixStub);
  await initI18n();
});
afterEach(async () => {
  cleanup();
  await setLanguage('vi');
});

const LEVEL: RoadmapLevel = {
  center: {
    id: 'r',
    kind: 'request',
    title: 'Trang đăng nhập',
    identifier: 'TPS-12',
    status: 'in_progress',
    total: 5,
    done: 3,
  },
  nodes: [
    {
      id: 'a',
      kind: 'ticket',
      title: 'Form',
      identifier: 'TPS-13',
      status: 'done',
      parentId: 'r',
      assignee: 'Dev Agent',
    },
    {
      id: 'b',
      kind: 'ticket',
      title: 'Duyệt CLI',
      identifier: 'TPS-14',
      status: 'blocked',
      parentId: 'r',
      children: 2,
    },
    { id: 'more', kind: 'more', title: '', extra: 7 },
  ],
  edges: [
    { id: 'r->a', source: 'r', target: 'a', kind: 'parent' },
    { id: 'r->b', source: 'r', target: 'b', kind: 'parent' },
    { id: 'a=>b', source: 'a', target: 'b', kind: 'blocks' },
  ],
  overflow: 7,
  layout: 'tree',
};

const buttons = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('button[data-roadmap-id]')];

describe('RoadmapCanvas', () => {
  it('mỗi nút một button, aria-label đủ nghĩa, nút "+N" ghi số', async () => {
    const { container } = render(
      <RoadmapCanvas level={LEVEL} levelKey="r" direction="none" onOpen={() => {}} labels={{ canvas: 'Bản đồ' }} />,
    );
    await screen.findByText('Trang đăng nhập');
    expect(buttons(container).map((b) => b.dataset.roadmapId)).toEqual(['r', 'a', 'b', 'more']);
    const label = (id: string) => container.querySelector(`[data-roadmap-id="${id}"]`)?.getAttribute('aria-label');
    expect(label('r')).toBe('TPS-12: Trang đăng nhập, Đang làm, 3/5 việc con xong');
    expect(label('a')).toBe('TPS-13: Form, Hoàn thành, Dev Agent');
    expect(label('b')).toBe('TPS-14: Duyệt CLI, Bị chặn, Chưa giao');
    expect(screen.getByText('+7 khác')).toBeTruthy();
    expect(screen.getByText('3/5 việc con xong')).toBeTruthy();
  });

  it('bấm nút gọi onOpen với đúng nút (việc con, tâm, "+N")', async () => {
    const onOpen = vi.fn();
    const { container } = render(
      <RoadmapCanvas level={LEVEL} levelKey="r" direction="none" onOpen={onOpen} labels={{ canvas: 'Bản đồ' }} />,
    );
    await screen.findByText('Trang đăng nhập');
    const [center, a, , more] = buttons(container);
    fireEvent.click(a);
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a', kind: 'ticket' }));
    fireEvent.click(center);
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'r' }));
    fireEvent.click(more);
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'more', extra: 7 }));
  });

  it('chú giải có 7 trạng thái và hai loại cạnh; nút tắt không gọi onOpen', async () => {
    const onOpen = vi.fn();
    const level: RoadmapLevel = {
      center: { id: 'p', kind: 'project', title: 'Crew', total: 0, open: 0 },
      nodes: [{ id: 'docs:p', kind: 'docs', title: 'Docs', total: 0, disabled: true }],
      edges: [],
      overflow: 0,
      layout: 'rings',
    };
    const { container } = render(
      <RoadmapCanvas level={level} levelKey="p" direction="in" onOpen={onOpen} labels={{ canvas: 'Bản đồ' }} />,
    );
    const legend = await screen.findByRole('region', { name: 'Chú thích' });
    expect(legend.querySelectorAll('li')).toHaveLength(9);
    const docs = container.querySelector<HTMLButtonElement>('[data-roadmap-id="docs:p"]');
    expect(docs?.getAttribute('aria-disabled')).toBe('true');
    expect(docs?.textContent).toContain('Chưa có docs');
    fireEvent.click(docs as HTMLButtonElement);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('RoadmapList', () => {
  it('danh sách lồng nhau, bấm dòng gọi onOpen', () => {
    const onOpen = vi.fn();
    render(
      <RoadmapList
        label="Danh sách"
        center={LEVEL.center}
        items={[{ node: LEVEL.nodes[0], children: [{ node: LEVEL.nodes[1], children: [] }] }]}
        empty="Trống"
        onOpen={onOpen}
      />,
    );
    const region = screen.getByRole('region', { name: 'Danh sách' });
    expect(region.querySelectorAll('ul')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /TPS-14/ }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  });
});
