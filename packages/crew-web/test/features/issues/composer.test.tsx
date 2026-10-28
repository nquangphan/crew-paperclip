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

describe('Composer: gọi Trợ Lý bằng tag', () => {
  const A1 = '11111111-1111-4111-8111-111111111111';
  const ROLES = 'GET /api/plugins/crew.core/api/projects/p1/roles';
  const CALL = 'POST /api/crew/companies/c1/issues/i1/assistant-call';
  const roles = {
    body: { roles: { assistantAgentId: A1, executorAgentIds: [], reviewerAgentId: 'r', integratorAgentId: 'g' } },
  };
  const submit = (value: string) => {
    fireEvent.change(box(), { target: { value } });
    fireEvent.click(send());
  };

  it('đổi @tro-ly thành link tới Trợ Lý, gửi bình luận rồi gọi assistant-call với id bình luận', async () => {
    const s = mockServer({
      [ROLES]: roles,
      'POST /api/issues/i1/comments': { body: { id: 'cm9' } },
      [CALL]: { status: 202, body: { status: 'queued', runId: 'r1' } },
    });
    mount(<Composer issue={ISSUE as unknown as Issue} />);
    submit('@tro-ly cho UIUX làm lại icon');
    await waitFor(() => expect(calls(s, 'POST', '/assistant-call')).toHaveLength(1));
    expect(calls(s, 'POST', '/comments')[0].body).toEqual({ body: `[@Trợ Lý](agent://${A1}) cho UIUX làm lại icon` });
    expect(calls(s, 'POST', '/assistant-call')[0].body).toEqual({ commentId: 'cm9' });
    await waitFor(() => expect(box().value).toBe(''));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('bình luận không có tag thì không đọc vai trò, không gọi Trợ Lý', async () => {
    const s = mockServer({ 'POST /api/issues/i1/comments': { body: { id: 'cm1' } } });
    mount(<Composer issue={ISSUE as unknown as Issue} />);
    submit('email@tro-ly.vn không phải tag');
    await waitFor(() => expect(calls(s, 'POST', '/comments')).toHaveLength(1));
    expect(calls(s, 'GET', '/roles')).toHaveLength(0);
    expect(calls(s, 'POST', '/assistant-call')).toHaveLength(0);
  });

  it('project chưa có Trợ Lý: gửi nguyên chữ và báo nhẹ', async () => {
    const s = mockServer({
      [ROLES]: { body: { roles: null } },
      'POST /api/issues/i1/comments': { body: { id: 'cm2' } },
    });
    mount(<Composer issue={ISSUE as unknown as Issue} />);
    submit('@Trợ Lý vào làm đi');
    expect(await screen.findByText('Project này chưa có Trợ Lý')).toBeTruthy();
    expect(calls(s, 'POST', '/comments')[0].body).toEqual({ body: '@Trợ Lý vào làm đi' });
    expect(calls(s, 'POST', '/assistant-call')).toHaveLength(0);
  });

  it('issue không có project thì coi như không có Trợ Lý', async () => {
    const s = mockServer({ 'POST /api/issues/i1/comments': { body: { id: 'cm3' } } });
    mount(<Composer issue={{ ...ISSUE, projectId: null } as unknown as Issue} />);
    submit('@tro-ly xem');
    expect(await screen.findByText('Project này chưa có Trợ Lý')).toBeTruthy();
    expect(calls(s, 'GET', '/roles')).toHaveLength(0);
  });

  it('gọi Trợ Lý lỗi (403) thì bình luận vẫn gửi, báo nhẹ, và thông báo mất ở lần gửi sau', async () => {
    const s = mockServer({
      [ROLES]: roles,
      'POST /api/issues/i1/comments': { body: { id: 'cm4' } },
      [CALL]: { status: 403, body: { error: 'Crew: chỉ owner của company được làm việc này.' } },
    });
    mount(<Composer issue={ISSUE as unknown as Issue} />);
    submit('@tro-ly làm đi');
    expect(await screen.findByText(/Đã gửi bình luận nhưng chưa gọi được Trợ Lý:/)).toBeTruthy();
    expect(calls(s, 'POST', '/comments')).toHaveLength(1);
    expect(screen.queryByText('Không gửi được bình luận')).toBeNull();
    submit('cảm ơn');
    await waitFor(() => expect(calls(s, 'POST', '/comments')).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });
});
