import { describe, expect, it } from 'vitest';
import {
  commentAnswerBody,
  parseCommentQuestions,
  pendingQuestions,
  summaryQuestions,
} from '@/features/issues/detail/crew/comment-questions';

// Hai kiểu viết agent đang dùng: mẫu của Trợ Lý (tổng kết, comment chờ owner) và báo cáo có chữ đậm.
const ASSISTANT = `### Cần owner quyết định
Q1. Làm ở project nào?
- a) Tạo lại ở project 2.0 — crew 2.0 làm
- b) Làm ở đây — không khả thi
- Đề xuất: a — repo đúng nằm ở 2.0`;

const REPORT = `## 5. Điểm cần Đại Ca chốt

**Q1. Có chờ log thiết bị trước khi sửa không?**
- a) Làm ngay việc 1+2+4.
- b) Chờ log rồi mới sửa.
- **Đề xuất a):** các việc này đúng bất kể nguyên nhân.

**Q2. (thông tin, không phải lựa chọn)** Hiện tượng xảy ra trên iPhone hay Android?

## Nguồn
- a) không phải lựa chọn`;

const comment = (over: Record<string, unknown>) =>
  ({
    id: 'c',
    authorAgentId: 'ag1',
    authorUserId: null,
    body: ASSISTANT,
    createdAt: '2026-10-23T08:00:00Z',
    ...over,
  }) as never;

describe('parseCommentQuestions', () => {
  it('đọc câu hỏi, lựa chọn và đề xuất theo mẫu của Trợ Lý', () => {
    expect(parseCommentQuestions(ASSISTANT)).toEqual([
      {
        id: 'q1',
        prompt: 'Q1. Làm ở project nào?',
        helpText: 'Đề xuất: a — repo đúng nằm ở 2.0',
        selectionMode: 'single',
        required: true,
        allowOther: true,
        options: [
          { id: 'a', label: 'a) Tạo lại ở project 2.0 — crew 2.0 làm' },
          { id: 'b', label: 'b) Làm ở đây — không khả thi' },
        ],
      },
    ]);
  });

  it('bỏ chữ đậm, câu hỏi thông tin chỉ có ô nhập chữ, tiêu đề mới thì hết câu hỏi', () => {
    const qs = parseCommentQuestions(REPORT);
    expect(qs.map((q) => q.prompt)).toEqual([
      'Q1. Có chờ log thiết bị trước khi sửa không?',
      'Q2. (thông tin, không phải lựa chọn) Hiện tượng xảy ra trên iPhone hay Android?',
    ]);
    expect(qs[0].helpText).toBe('Đề xuất a): các việc này đúng bất kể nguyên nhân.');
    expect(qs[0].options.map((o) => o.label)).toEqual(['a) Làm ngay việc 1+2+4.', 'b) Chờ log rồi mới sửa.']);
    expect(qs[1].options).toEqual([{ id: 'text', label: qs[1].prompt, freeText: true }]);
  });

  it('đọc câu hỏi viết gọn một dòng có chữ đậm', () => {
    const qs = parseCommentQuestions(
      '- **Q3. Phụ huynh chưa có bé thì sao?** a) Ẩn tab (như giáo viên). b) Giữ tab. **Đề xuất a**: gọn hơn.',
    );
    expect(qs).toHaveLength(1);
    expect(qs[0].prompt).toBe('Q3. Phụ huynh chưa có bé thì sao?');
    expect(qs[0].options.map((o) => o.label)).toEqual(['a) Ẩn tab (như giáo viên).', 'b) Giữ tab.']);
    expect(qs[0].helpText).toBe('Đề xuất a: gọn hơn.');
  });

  it('bình luận nhắc lại lựa chọn đã chốt, hay câu hỏi nằm trong khối code, thì không phải câu hỏi', () => {
    expect(parseCommentQuestions('Owner đã chọn:\n- Q1: a — giữ như cũ\n- Q2: b')).toEqual([]);
    expect(parseCommentQuestions('```\nQ1. Hỏi?\n- a) x\n- b) y\n```')).toEqual([]);
    expect(parseCommentQuestions('Q1. Hỏi?\n- a) x\n- c) y')).toEqual([]);
  });
});

describe('pendingQuestions', () => {
  it('lấy bình luận agent mới nhất còn câu hỏi', () => {
    const found = pendingQuestions(
      [comment({ id: 'old' }), comment({ id: 'new', createdAt: '2026-10-23T09:00:00Z', body: 'Tình trạng: đang làm' })],
      [],
    );
    expect(found?.comment.id).toBe('old');
  });

  it('người đã bình luận sau đó thì coi như đã trả lời', () => {
    const answered = comment({
      id: 'u',
      authorAgentId: null,
      authorUserId: 'u1',
      body: 'Q1: a',
      createdAt: '2026-10-23T09:00:00Z',
    });
    expect(pendingQuestions([comment({}), answered], [])).toBeNull();
  });

  it('bình luận đi kèm thẻ câu hỏi (tạo trước đó ít phút, hay sau đó) thì không dựng thẻ nữa', () => {
    expect(pendingQuestions([comment({})], [{ createdAt: '2026-10-23T07:55:00Z' }])).toBeNull();
    expect(pendingQuestions([comment({})], [{ createdAt: '2026-10-23T10:00:00Z' }])).toBeNull();
    expect(pendingQuestions([comment({})], [{ createdAt: '2026-10-22T08:00:00Z' }])).not.toBeNull();
  });
});

describe('câu hỏi trong tổng kết', () => {
  const desc = `Yêu cầu của owner: Q1. không phải câu hỏi của Trợ Lý\n- a) x\n- b) y\n\n## Tổng kết của Trợ Lý\n\n### Đã tự quyết định\n- Không có.\n\n${ASSISTANT}\n\n### Ghi chú\n- a) không phải lựa chọn`;

  it('chỉ đọc mục Cần owner quyết định', () => {
    expect(summaryQuestions(desc).map((q) => q.prompt)).toEqual(['Q1. Làm ở project nào?']);
    expect(summaryQuestions('## Tổng kết\n### Cần owner quyết định\n- Không có.')).toEqual([]);
    expect(summaryQuestions(null)).toEqual([]);
  });

  it('gắn với bình luận crew-assistant done đi cùng tổng kết', () => {
    const done = comment({ id: 'done', body: 'crew-assistant done children=TPS-1\nTrợ Lý: xong.' });
    const found = pendingQuestions([done], [], desc);
    expect(found).toMatchObject({ fromSummary: true, comment: { id: 'done' } });
    expect(pendingQuestions([done], [], 'không có tổng kết')).toBeNull();
  });
});

describe('commentAnswerBody', () => {
  it('mỗi câu một dòng Qn kèm nhãn lựa chọn, "Khác" kèm chữ', () => {
    const qs = parseCommentQuestions(REPORT);
    const body = commentAnswerBody('Trả lời câu hỏi:', 'Khác', qs, [
      { questionId: 'q1', optionIds: [], otherText: 'Làm ngay việc 1' },
      { questionId: 'q2', optionIds: ['text'], otherText: 'iPhone' },
    ]);
    expect(body).toBe('Trả lời câu hỏi:\n- Q1: Khác — Làm ngay việc 1\n- Q2: iPhone');
    expect(commentAnswerBody('H', 'Khác', qs, [{ questionId: 'q1', optionIds: ['b'] }])).toBe(
      'H\n- Q1: b) Chờ log rồi mới sửa.',
    );
  });
});
