// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { InteractionsSlot } from '@/features/issues/detail/crew/interactions-slot';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { ISSUE, mount } from './detail-fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

// Hình interaction theo packages/shared/src/validators/issue.ts (askUserQuestionsPayloadSchema,
// requestConfirmationPayloadSchema, requestCheckboxConfirmationPayloadSchema).
const base = { companyId: 'c1', issueId: 'i1', status: 'pending', createdAt: '2026-10-10T01:00:00.000Z' };
const QUESTION = {
  ...base,
  id: 'q1',
  kind: 'ask_user_questions',
  title: 'Trợ Lý cần hỏi thêm',
  payload: {
    version: 1,
    questions: [
      {
        id: 'db',
        prompt: 'Dùng cơ sở dữ liệu nào?',
        selectionMode: 'single',
        required: true,
        allowOther: true,
        options: [
          { id: 'pg', label: 'Postgres' },
          { id: 'sqlite', label: 'SQLite' },
        ],
      },
    ],
  },
};
const CONFIRM = {
  ...base,
  id: 'c9',
  kind: 'request_confirmation',
  payload: { version: 1, prompt: 'Cho phép xóa nhánh cũ?', allowDeclineReason: true },
};
const CHECKBOX = {
  ...base,
  id: 'k1',
  kind: 'request_checkbox_confirmation',
  payload: {
    version: 1,
    prompt: 'Chọn phần muốn làm',
    options: [
      { id: 'a', label: 'Phần A' },
      { id: 'b', label: 'Phần B' },
    ],
    defaultSelectedOptionIds: ['a'],
    minSelected: 0,
  },
};

const posts = (s: ReturnType<typeof mockServer>) => s.calls.filter((c) => c.method === 'POST');

describe('InteractionsSlot (S6.9)', () => {
  it('chỉ hiện thẻ đang chờ', async () => {
    mockServer({
      'GET /api/issues/i1/interactions': { body: [QUESTION, { ...CONFIRM, status: 'accepted' }] },
    });
    mount(<InteractionsSlot issue={ISSUE as never} />);
    expect(await screen.findByText('Dùng cơ sở dữ liệu nào?')).toBeTruthy();
    expect(screen.queryByText('Cho phép xóa nhánh cũ?')).toBeNull();
  });

  it('chọn phương án rồi gửi POST …/respond với answers đúng hình', async () => {
    const s = mockServer({
      'GET /api/issues/i1/interactions': { body: [QUESTION] },
      'POST /api/issues/i1/interactions/q1/respond': { body: { ...QUESTION, status: 'answered' } },
    });
    mount(<InteractionsSlot issue={ISSUE as never} />);
    const card = await screen.findByTestId('interaction-card');
    const send = within(card).getByRole('button', { name: 'Gửi trả lời' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(within(card).getByRole('button', { name: 'Postgres' }));
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    expect(posts(s)[0].url).toBe('/api/issues/i1/interactions/q1/respond');
    expect(posts(s)[0].body).toEqual({ answers: [{ questionId: 'db', optionIds: ['pg'] }] });
  });

  it('"Khác" + chữ thì respond có otherText', async () => {
    const s = mockServer({
      'GET /api/issues/i1/interactions': { body: [QUESTION] },
      'POST /api/issues/i1/interactions/q1/respond': { body: { ...QUESTION, status: 'answered' } },
    });
    mount(<InteractionsSlot issue={ISSUE as never} />);
    const card = await screen.findByTestId('interaction-card');
    fireEvent.click(within(card).getByRole('button', { name: 'Khác' }));
    fireEvent.change(within(card).getByRole('textbox'), { target: { value: 'MySQL 8' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Gửi trả lời' }));
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    expect(posts(s)[0].body).toEqual({ answers: [{ questionId: 'db', optionIds: [], otherText: 'MySQL 8' }] });
  });

  it('phương án freeText là ô "Khác" của chính câu hỏi: gửi kèm id phương án', async () => {
    const q = {
      ...QUESTION,
      payload: {
        version: 1,
        questions: [
          {
            id: 'db',
            prompt: 'Dùng cơ sở dữ liệu nào?',
            selectionMode: 'single',
            options: [
              { id: 'pg', label: 'Postgres' },
              { id: 'other', label: 'Tôi tự mô tả', freeText: true },
            ],
          },
        ],
      },
    };
    const s = mockServer({
      'GET /api/issues/i1/interactions': { body: [q] },
      'POST /api/issues/i1/interactions/q1/respond': { body: { ...q, status: 'answered' } },
    });
    mount(<InteractionsSlot issue={ISSUE as never} />);
    const card = await screen.findByTestId('interaction-card');
    expect(within(card).queryByRole('button', { name: 'Khác' })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Tôi tự mô tả' }));
    fireEvent.change(within(card).getByRole('textbox'), { target: { value: 'DynamoDB' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Gửi trả lời' }));
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    expect(posts(s)[0].body).toEqual({ answers: [{ questionId: 'db', optionIds: ['other'], otherText: 'DynamoDB' }] });
  });

  it('thẻ xác nhận: Đồng ý gọi accept', async () => {
    const s = mockServer({
      'GET /api/issues/i1/interactions': { body: [CONFIRM] },
      'POST /api/issues/i1/interactions/c9/accept': { body: { ...CONFIRM, status: 'accepted' } },
    });
    mount(<InteractionsSlot issue={ISSUE as never} />);
    const card = await screen.findByTestId('interaction-card');
    expect(within(card).getByText('Cho phép xóa nhánh cũ?')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Đồng ý' }));
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    expect(posts(s)[0].url).toBe('/api/issues/i1/interactions/c9/accept');
    expect(posts(s)[0].body).toEqual({});
  });

  it('thẻ xác nhận: Từ chối gọi reject kèm lý do', async () => {
    const s = mockServer({
      'GET /api/issues/i1/interactions': { body: [CONFIRM] },
      'POST /api/issues/i1/interactions/c9/reject': { body: { ...CONFIRM, status: 'rejected' } },
    });
    mount(<InteractionsSlot issue={ISSUE as never} />);
    const card = await screen.findByTestId('interaction-card');
    fireEvent.change(within(card).getByRole('textbox'), { target: { value: 'Còn dùng nhánh đó' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Từ chối' }));
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    expect(posts(s)[0].url).toBe('/api/issues/i1/interactions/c9/reject');
    expect(posts(s)[0].body).toEqual({ reason: 'Còn dùng nhánh đó' });
  });

  it('từ chối bắt buộc lý do thì nút tắt khi chưa ghi', async () => {
    mockServer({
      'GET /api/issues/i1/interactions': {
        body: [{ ...CONFIRM, payload: { ...CONFIRM.payload, rejectRequiresReason: true } }],
      },
    });
    mount(<InteractionsSlot issue={ISSUE as never} />);
    const card = await screen.findByTestId('interaction-card');
    expect((within(card).getByRole('button', { name: 'Từ chối' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('thẻ chọn ô: accept gửi selectedOptionIds theo ô đã tick', async () => {
    const s = mockServer({
      'GET /api/issues/i1/interactions': { body: [CHECKBOX] },
      'POST /api/issues/i1/interactions/k1/accept': { body: { ...CHECKBOX, status: 'accepted' } },
    });
    mount(<InteractionsSlot issue={ISSUE as never} />);
    const card = await screen.findByTestId('interaction-card');
    fireEvent.click(within(card).getByRole('checkbox', { name: 'Phần B' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Đồng ý' }));
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    expect(posts(s)[0].body).toEqual({ selectedOptionIds: ['a', 'b'] });
  });

  it('lỗi server hiện nguyên văn trong thẻ', async () => {
    mockServer({
      'GET /api/issues/i1/interactions': { body: [CONFIRM] },
      'POST /api/issues/i1/interactions/c9/accept': { status: 409, body: { error: 'Interaction is already resolved' } },
    });
    mount(<InteractionsSlot issue={ISSUE as never} />);
    const card = await screen.findByTestId('interaction-card');
    fireEvent.click(within(card).getByRole('button', { name: 'Đồng ý' }));
    expect(await within(card).findByText('Interaction is already resolved')).toBeTruthy();
  });

  it('yêu cầu đã done/cancelled thì không hiện thẻ, không tải câu hỏi', async () => {
    for (const status of ['done', 'cancelled']) {
      const s = mockServer({ 'GET /api/issues/i1/interactions': { body: [QUESTION] } });
      const { container } = mount(<InteractionsSlot issue={{ ...ISSUE, status } as never} />);
      await new Promise((r) => setTimeout(r, 20));
      expect(container.textContent).toBe('');
      expect(s.calls).toHaveLength(0);
      cleanup();
    }
  });

  it('không có thẻ đang chờ thì không render gì', async () => {
    const s = mockServer({ 'GET /api/issues/i1/interactions': { body: [] } });
    const { container } = mount(<InteractionsSlot issue={ISSUE as never} />);
    await waitFor(() => expect(s.calls.length).toBe(1));
    expect(container.textContent).toBe('');
  });
});
