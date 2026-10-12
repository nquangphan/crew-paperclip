// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CrewMap as CrewMapData } from '@/api/crew/types';
import { CrewMap } from '@/ds';
import { initI18n, setLanguage } from '@/i18n';
import fixture from './__fixtures__/map.json';

const map = fixture as unknown as CrewMapData;

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

const card = (root: HTMLElement, id: string) => root.querySelector<HTMLButtonElement>(`[data-roadmap-id="${id}"]`);

describe('CrewMap (vẽ bằng canvas Roadmap)', () => {
  it('mỗi issue một thẻ Roadmap: gốc ở tâm là thẻ yêu cầu, còn lại là thẻ việc con', async () => {
    const { container } = render(<CrewMap map={map} onOpenIssue={() => {}} />);
    await screen.findByText('Thêm bản đồ yêu cầu');
    const cards = [...container.querySelectorAll<HTMLElement>('button[data-roadmap-id]')];
    expect(cards.map((c) => c.dataset.roadmapId)).toEqual(['i-root', 'i-a', 'i-b', 'i-c', 'i-fix']);
    expect(card(container, 'i-root')?.dataset.roadmapKind).toBe('request');
    expect(card(container, 'i-root')?.dataset.center).toBe('true');
    expect(card(container, 'i-b')?.dataset.roadmapKind).toBe('ticket');
    expect(screen.getByText('1/4 việc con xong')).toBeTruthy();
  });

  it('bấm việc con hoặc gốc gọi onOpenIssue với id issue', async () => {
    const onOpen = vi.fn();
    const { container } = render(<CrewMap map={map} onOpenIssue={onOpen} />);
    await screen.findByText('Thêm bản đồ yêu cầu');
    fireEvent.click(card(container, 'i-b') as HTMLButtonElement);
    expect(onOpen).toHaveBeenLastCalledWith('i-b');
    fireEvent.click(card(container, 'i-root') as HTMLButtonElement);
    expect(onOpen).toHaveBeenLastCalledWith('i-root');
  });

  it('tô việc đang xem và hiện chẩn đoán cạnh thiếu issue', async () => {
    const { container } = render(<CrewMap map={map} currentIssueId="i-b" onOpenIssue={() => {}} />);
    await screen.findByText('Thêm bản đồ yêu cầu');
    const current = card(container, 'i-b');
    expect(current?.dataset.current).toBe('true');
    expect(current?.getAttribute('aria-current')).toBe('true');
    expect(card(container, 'i-a')?.hasAttribute('aria-current')).toBe(false);
    expect(screen.getByText(/thiếu issue/)).toBeTruthy();
  });

  it('thẻ ghi trạng thái, người làm, giai đoạn và vòng sửa (khi có); loại việc, bundle và số vòng 0 nằm trong tooltip', async () => {
    const { container } = render(<CrewMap map={map} onOpenIssue={() => {}} />);
    await screen.findByText('Thêm bản đồ yêu cầu');
    const b = card(container, 'i-b') as HTMLButtonElement;
    expect(b.textContent).toContain('CRE-38 · Đang duyệt');
    expect(b.textContent).toContain('executor');
    expect(b.textContent).toContain('Reviewer');
    expect(b.textContent).not.toContain('Vòng sửa');
    const a = card(container, 'i-a') as HTMLButtonElement;
    expect(a.textContent).toContain('Vòng sửa 1/5 · Đã xong');
    expect(a.title).toBe(
      'CRE-37 · Thêm trang đăng nhập\nLập trình\nGiai đoạn: Đã xong\nNgười làm: executor · Vòng sửa: 1/5\nBundle b1 #1',
    );
    expect(a.getAttribute('aria-label')).toContain('Bundle b1 #1');
    expect(card(container, 'i-fix')?.title).toContain('Sửa');
  });

  it('chú giải có cạnh cha-con, chặn, vòng sửa và việc đang xem', async () => {
    render(<CrewMap map={map} onOpenIssue={() => {}} />);
    const legend = await screen.findByRole('region', { name: 'Chú thích' });
    const items = [...legend.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual(expect.arrayContaining(['Cha → con', 'Chặn (phải xong trước)', 'Vòng sửa', 'Việc đang xem']));
    expect(items).toHaveLength(11);
  });

  it('nhãn theo ngôn ngữ đang chọn (en)', async () => {
    await setLanguage('en');
    const { container } = render(<CrewMap map={map} onOpenIssue={() => {}} />);
    await screen.findByText('Thêm bản đồ yêu cầu');
    expect(card(container, 'i-a')?.textContent).toContain('Fix rounds 1/5');
    expect(screen.getByRole('region', { name: 'Crew request map' })).toBeTruthy();
  });
});
