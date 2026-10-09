// @vitest-environment jsdom

import type { Issue } from '@paperclipai/shared';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DescriptionEditor, TitleEditor } from '@/features/issues/detail/title-editor';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { ISSUE, mount } from './detail-fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const issue = ISSUE as unknown as Issue;
const find = (s: ReturnType<typeof mockServer>, method: string, tail: string) =>
  s.calls.filter((c) => c.method === method && c.url.endsWith(tail));

describe('TitleEditor (S6.12)', () => {
  it('sửa tiêu đề gọi PUT /issues/:id/title {title}', async () => {
    const s = mockServer({ 'PUT /api/issues/i1/title': { body: { id: 'i1', title: 'Tiêu đề mới', changed: true } } });
    mount(<TitleEditor issue={issue} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sửa tiêu đề' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Tiêu đề' }), { target: { value: 'Tiêu đề mới' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(find(s, 'PUT', '/title')).toHaveLength(1));
    expect(find(s, 'PUT', '/title')[0].body).toEqual({ title: 'Tiêu đề mới' });
    expect(find(s, 'PATCH', '/issues/i1')).toHaveLength(0);
  });

  it('tiêu đề rỗng không cho lưu', () => {
    mockServer({});
    mount(<TitleEditor issue={issue} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sửa tiêu đề' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Tiêu đề' }), { target: { value: '   ' } });
    expect((screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Hủy thì không gọi API', () => {
    const s = mockServer({});
    mount(<TitleEditor issue={issue} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sửa tiêu đề' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(s.calls).toHaveLength(0);
    expect(screen.getByText('Sửa trang đăng nhập')).toBeTruthy();
  });
});

describe('DescriptionEditor (S6.12)', () => {
  it('sửa mô tả gọi PATCH chỉ với {description}', async () => {
    const s = mockServer({ 'PATCH /api/issues/i1': { body: { id: 'i1' } } });
    mount(<DescriptionEditor issue={issue} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sửa mô tả' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Mô tả' }), { target: { value: 'Mô tả mới' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(find(s, 'PATCH', '/issues/i1')).toHaveLength(1));
    expect(find(s, 'PATCH', '/issues/i1')[0].body).toEqual({ description: 'Mô tả mới' });
  });

  it('lỗi lưu hiện nguyên văn', async () => {
    mockServer({ 'PATCH /api/issues/i1': { status: 422, body: { error: 'mô tả quá dài' } } });
    mount(<DescriptionEditor issue={issue} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sửa mô tả' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Mô tả' }), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText(/mô tả quá dài/)).toBeTruthy();
  });
});
