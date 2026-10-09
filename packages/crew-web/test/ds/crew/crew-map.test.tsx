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

describe('CrewMap', () => {
  it('số node render bằng số node của fixture', async () => {
    const { container } = render(<CrewMap map={map} onOpenIssue={() => {}} />);
    await screen.findByText(/CRE-38/);
    expect(container.querySelectorAll('[data-issue-id]').length).toBe(map.nodes.length);
  });
  it('click node gọi onOpenIssue với id issue', async () => {
    const onOpen = vi.fn();
    render(<CrewMap map={map} onOpenIssue={onOpen} />);
    fireEvent.click(await screen.findByText(/CRE-38/));
    expect(onOpen).toHaveBeenCalledWith('i-b');
  });
  it('đánh dấu issue hiện tại và hiện chẩn đoán cạnh thiếu issue', async () => {
    const { container } = render(<CrewMap map={map} currentIssueId="i-b" onOpenIssue={() => {}} />);
    await screen.findByText(/CRE-38/);
    expect(container.querySelector('[data-issue-id="i-b"]')?.getAttribute('data-current')).toBe('true');
    expect(screen.getByText(/thiếu issue/)).toBeTruthy();
  });
  it('nhãn giai đoạn và trạng thái qua t()', async () => {
    render(<CrewMap map={map} onOpenIssue={() => {}} />);
    await screen.findByText(/CRE-38/);
    expect(screen.getAllByText(/Giai đoạn: Reviewer/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Đang duyệt/).length).toBeGreaterThan(0);
  });
});
