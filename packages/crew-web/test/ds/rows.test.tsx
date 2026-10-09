// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AgentRow, FilterBar, IssueRow, PageHeader, PropertyList, RunRow, Transcript } from '@/ds';
import { initI18n, setLanguage } from '@/i18n';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

describe('IssueRow / RunRow / AgentRow', () => {
  it('IssueRow hiện mã, tiêu đề, trạng thái và gọi onOpen', () => {
    const onOpen = vi.fn();
    render(<IssueRow identifier="CRE-7" title="Sửa lỗi" status="todo" href="/CRE/issues/CRE-7" onOpen={onOpen} />);
    expect(screen.getByText('CRE-7')).toBeTruthy();
    expect(screen.getByText('Cần làm')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: /Sửa lỗi/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
  it('RunRow hiện trạng thái run', () => {
    render(<RunRow id="abcdef12-0000" status="failed" agentName="Trợ Lý" startedAt="2026-10-09T17:31:26Z" href="/x" />);
    expect(screen.getByText('Lỗi')).toBeTruthy();
    expect(screen.getByText(/abcdef12/)).toBeTruthy();
    expect(screen.getByText(/10\/10\/2026 00:31/)).toBeTruthy();
  });
  it('AgentRow hiện tên và trạng thái', () => {
    render(<AgentRow name="Reviewer" roleLabel="reviewer" status="idle" href="/y" />);
    expect(screen.getByText('Reviewer')).toBeTruthy();
    expect(screen.getByText('Rảnh')).toBeTruthy();
  });
});

describe('Transcript', () => {
  it('mặc định thu gọn, mở ra thì thấy nội dung', () => {
    render(<Transcript entries={[{ id: '1', role: 'assistant', text: 'đang chạy test' }]} />);
    expect(screen.queryByText('đang chạy test')).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('đang chạy test')).toBeTruthy();
  });
  it('rỗng thì hiện câu trống', () => {
    render(<Transcript entries={[]} />);
    expect(screen.getByText('Chưa có nội dung')).toBeTruthy();
  });
});

describe('PropertyList / PageHeader / FilterBar', () => {
  it('PropertyList hiện nhãn và giá trị', () => {
    render(<PropertyList items={[{ label: 'Người làm', value: 'Trợ Lý' }]} />);
    expect(screen.getByText('Người làm')).toBeTruthy();
    expect(screen.getByText('Trợ Lý')).toBeTruthy();
  });
  it('PageHeader hiện tiêu đề, mô tả, hành động', () => {
    render(<PageHeader title="Yêu cầu" description="mô tả" actions={<button type="button">Mới</button>} />);
    expect(screen.getByRole('heading', { name: 'Yêu cầu' })).toBeTruthy();
    expect(screen.getByText('mô tả')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mới' })).toBeTruthy();
  });
  it('FilterBar ô tìm gọi onChange, nút xóa lọc gọi onReset', () => {
    const onChange = vi.fn();
    const onReset = vi.fn();
    render(<FilterBar search={{ value: '', onChange, placeholder: 'Tìm' }} onReset={onReset} />);
    fireEvent.change(screen.getByPlaceholderText('Tìm'), { target: { value: 'abc' } });
    expect(onChange).toHaveBeenCalledWith('abc');
    fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
    expect(onReset).toHaveBeenCalled();
  });
});
