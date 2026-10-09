// @vitest-environment jsdom

import type { Issue } from '@paperclipai/shared';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Composer } from '@/features/issues/detail/composer';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { ISSUE, mount } from './detail-fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const box = () => screen.getByRole('textbox') as HTMLTextAreaElement;
const send = () => screen.getByRole('button', { name: 'Gửi bình luận' });
const calls = (s: ReturnType<typeof mockServer>, method: string, urlPart: string) =>
  s.calls.filter((c) => c.method === method && c.url.includes(urlPart));

describe('Composer (S6.5)', () => {
  it('gửi POST /issues/:id/comments {body} rồi xóa ô soạn', async () => {
    const s = mockServer({ 'POST /api/issues/i1/comments': { body: { id: 'cm1' } } });
    mount(<Composer issue={ISSUE as unknown as Issue} />);
    expect((send() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box(), { target: { value: 'Xin chào' } });
    fireEvent.click(send());
    await waitFor(() => expect(calls(s, 'POST', '/comments')).toHaveLength(1));
    expect(calls(s, 'POST', '/comments')[0].body).toEqual({ body: 'Xin chào' });
    await waitFor(() => expect(box().value).toBe(''));
  });

  it('không có bộ chọn model hay effort', () => {
    mockServer({});
    mount(<Composer issue={ISSUE as unknown as Issue} />);
    expect(screen.queryAllByRole('combobox')).toEqual([]);
  });

  it('dán file thì upload đính kèm rồi chèn link vào nội dung', async () => {
    const s = mockServer({
      'POST /api/companies/c1/issues/i1/attachments': { body: { id: 'at1', originalFilename: 'anh.png' } },
    });
    mount(<Composer issue={ISSUE as unknown as Issue} />);
    const file = new File(['x'], 'anh.png', { type: 'image/png' });
    fireEvent.paste(box(), { clipboardData: { files: [file], items: [] } });
    await waitFor(() => expect(calls(s, 'POST', '/attachments')).toHaveLength(1));
    await waitFor(() => expect(box().value).toContain('[anh.png](/api/attachments/at1/content)'));
  });

  it('file đáng ngờ phải xác nhận trước khi upload', async () => {
    const s = mockServer({
      'POST /api/companies/c1/issues/i1/attachments': { body: { id: 'at2', originalFilename: 'a.zip' } },
    });
    mount(<Composer issue={ISSUE as unknown as Issue} />);
    const file = new File(['x'], 'a.zip');
    fireEvent.paste(box(), { clipboardData: { files: [file], items: [] } });
    expect(await screen.findByText(/Agent sẽ không đọc được file a\.zip/)).toBeTruthy();
    expect(calls(s, 'POST', '/attachments')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Gửi vẫn tiếp tục' }));
    await waitFor(() => expect(calls(s, 'POST', '/attachments')).toHaveLength(1));
  });

  it('lỗi gửi hiện nguyên văn và giữ nội dung', async () => {
    mockServer({ 'POST /api/issues/i1/comments': { status: 422, body: { error: 'comment rỗng không hợp lệ' } } });
    mount(<Composer issue={ISSUE as unknown as Issue} />);
    fireEvent.change(box(), { target: { value: 'abc' } });
    fireEvent.click(send());
    expect(await screen.findByText(/comment rỗng không hợp lệ/)).toBeTruthy();
    expect(box().value).toBe('abc');
  });
});
