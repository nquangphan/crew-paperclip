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
const loaded = (s: ReturnType<typeof mockServer>) =>
  ['/api/issues/i1/interactions', '/api/issues/i1/comments'].every((u) => s.calls.some((c) => c.url.startsWith(u)));

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
      expect(s.calls.filter((c) => c.url.includes('/interactions'))).toHaveLength(0);
      cleanup();
    }
  });

  it('không có thẻ đang chờ thì không render gì', async () => {
    const s = mockServer({
      'GET /api/issues/i1/interactions': { body: [] },
      'GET /api/issues/i1/comments': { body: [] },
    });
    const { container } = mount(<InteractionsSlot issue={ISSUE as never} />);
    await waitFor(() => expect(loaded(s)).toBe(true));
    expect(container.textContent).toBe('');
  });
});

// Agent viết điểm cần owner chốt trong bình luận (không tạo thẻ): trang dựng thẻ chọn từ bình luận đó.
const WORKING = { ...ISSUE, status: 'in_progress', assigneeAgentId: 'ag1', executionState: null };
const ASK_COMMENT = {
  id: 'cm1',
  companyId: 'c1',
  issueId: 'i1',
  authorType: 'agent',
  authorAgentId: 'ag1',
  authorUserId: null,
  createdAt: '2026-10-10T02:00:00.000Z',
  body: 'Tổng kết.\n\n### Cần owner quyết định\nQ1. Làm ở project nào?\n- a) Project 2.0 — crew 2.0 làm\n- b) Project này — không khả thi\n- Đề xuất: a — đúng repo',
};

describe('InteractionsSlot: câu hỏi trong bình luận', () => {
  it('dựng thẻ từ bình luận của agent đang giữ issue, gửi trả lời thành bình luận Qn', async () => {
    const s = mockServer({
      'GET /api/issues/i1/interactions': { body: [] },
      'GET /api/issues/i1/comments': { body: [ASK_COMMENT] },
      'POST /api/issues/i1/comments': { body: { ...ASK_COMMENT, id: 'cm2' } },
    });
    mount(<InteractionsSlot issue={WORKING as never} agentNames={{ ag1: 'kidy-school-assistant' }} />);
    const card = await screen.findByTestId('comment-questions-card');
    expect(within(card).getByText('kidy-school-assistant cần chốt')).toBeTruthy();
    expect(within(card).getByText('Đề xuất: a — đúng repo')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'a) Project 2.0 — crew 2.0 làm' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Gửi trả lời' }));
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    expect(posts(s)[0].url).toBe('/api/issues/i1/comments');
    expect(posts(s)[0].body).toEqual({ body: 'Trả lời câu hỏi:\n- Q1: a) Project 2.0 — crew 2.0 làm' });
  });

  it('bình luận của agent khác người đang giữ issue thì không dựng thẻ (trả lời không tới được người hỏi)', async () => {
    const s = mockServer({
      'GET /api/issues/i1/interactions': { body: [] },
      'GET /api/issues/i1/comments': { body: [ASK_COMMENT] },
    });
    const { container } = mount(<InteractionsSlot issue={{ ...WORKING, assigneeAgentId: 'a9' } as never} />);
    await waitFor(() => expect(loaded(s)).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });

  it('chờ owner duyệt: câu hỏi trong tổng kết đi kèm Duyệt (PATCH done + comment)', async () => {
    const summary =
      'Yêu cầu.\n\n## Tổng kết của Trợ Lý\n\n### Cần owner quyết định\nQ1. Làm code luôn không?\n- a) Tạo yêu cầu code mới\n- b) Dừng ở mockup\n- Đề xuất: a — đủ đặc tả';
    const done = { ...ASK_COMMENT, body: 'crew-assistant done children=TPS-3\nTrợ Lý: mọi issue con đã qua review.' };
    const root = { ...ISSUE, description: summary, assigneeAgentId: null, assigneeUserId: 'u1' };
    const s = mockServer({
      'GET /api/issues/i1/interactions': { body: [] },
      'GET /api/issues/i1/comments': { body: [done] },
      'GET /api/issues/i1': { body: root },
      'PATCH /api/issues/i1': { body: { ...root, status: 'done' } },
    });
    mount(<InteractionsSlot issue={root as never} />);
    const card = await screen.findByTestId('comment-questions-card');
    expect(within(card).queryByRole('button', { name: 'Gửi trả lời' })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'b) Dừng ở mockup' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Duyệt kèm trả lời' }));
    await waitFor(() => expect(s.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1));
    expect(s.calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      status: 'done',
      comment: 'Trả lời câu hỏi:\n- Q1: b) Dừng ở mockup',
    });
  });

  it('chờ owner duyệt: Yêu cầu sửa theo trả lời gửi status in_progress', async () => {
    const s = mockServer({
      'GET /api/issues/i1/interactions': { body: [] },
      'GET /api/issues/i1/comments': { body: [ASK_COMMENT] },
      'GET /api/issues/i1': { body: ISSUE },
      'PATCH /api/issues/i1': { body: { ...ISSUE, status: 'in_progress' } },
    });
    mount(<InteractionsSlot issue={ISSUE as never} />);
    const card = await screen.findByTestId('comment-questions-card');
    fireEvent.click(within(card).getByRole('button', { name: 'a) Project 2.0 — crew 2.0 làm' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Yêu cầu sửa theo trả lời' }));
    await waitFor(() => expect(s.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1));
    expect(s.calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      status: 'in_progress',
      comment: 'Trả lời câu hỏi:\n- Q1: a) Project 2.0 — crew 2.0 làm',
    });
  });

  it('có thẻ câu hỏi thật đang chờ thì chỉ hiện thẻ đó', async () => {
    mockServer({
      'GET /api/issues/i1/interactions': { body: [QUESTION] },
      'GET /api/issues/i1/comments': { body: [ASK_COMMENT] },
    });
    mount(<InteractionsSlot issue={ISSUE as never} />);
    expect(await screen.findByTestId('interaction-card')).toBeTruthy();
    expect(screen.queryByTestId('comment-questions-card')).toBeNull();
  });

  it('owner đã bình luận sau câu hỏi thì không dựng thẻ', async () => {
    const reply = {
      ...ASK_COMMENT,
      id: 'cm2',
      authorType: 'user',
      authorAgentId: null,
      authorUserId: 'u1',
      body: 'Q1: a',
      createdAt: '2026-10-10T03:00:00.000Z',
    };
    const s = mockServer({
      'GET /api/issues/i1/interactions': { body: [] },
      'GET /api/issues/i1/comments': { body: [ASK_COMMENT, reply] },
    });
    const { container } = mount(<InteractionsSlot issue={ISSUE as never} />);
    await waitFor(() => expect(loaded(s)).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });
});
