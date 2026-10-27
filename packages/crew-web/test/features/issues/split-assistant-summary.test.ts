import { describe, expect, it } from 'vitest';
import { splitAssistantSummary } from '@/features/issues/detail/split-assistant-summary';

describe('splitAssistantSummary', () => {
  it('không có heading thì summary = null và body giữ nguyên', () => {
    const text = 'Mô tả\n\n### Tổng kết của Trợ Lý\nx';
    expect(splitAssistantSummary(text)).toEqual({ body: text, summary: null });
    expect(splitAssistantSummary(null)).toEqual({ body: '', summary: null });
  });

  it('tách body và summary tới hết mô tả, giữ các mục ### con', () => {
    const r = splitAssistantSummary(
      'Mô tả\n\n## Tổng kết của Trợ Lý\n\n### Yêu cầu\nA\n\n### Kết quả\n![](/api/attachments/x/content)\n',
    );
    expect(r.body).toBe('Mô tả');
    expect(r.summary).toBe('### Yêu cầu\nA\n\n### Kết quả\n![](/api/attachments/x/content)');
  });

  it('chỉ lấy lần xuất hiện đầu tiên', () => {
    const r = splitAssistantSummary('## Tổng kết của Trợ Lý\nmột\n## Tổng kết của Trợ Lý\nhai');
    expect(r.body).toBe('');
    expect(r.summary).toBe('một\n## Tổng kết của Trợ Lý\nhai');
  });

  it('bỏ qua heading nằm trong code fence', () => {
    const text = 'Ví dụ:\n```md\n## Tổng kết của Trợ Lý\nx\n```\nhết';
    expect(splitAssistantSummary(text)).toEqual({ body: text, summary: null });
    const r = splitAssistantSummary('```\nđóng\n```\nGiữa\n## Tổng kết của Trợ Lý\nthật');
    expect(r.body).toBe('```\nđóng\n```\nGiữa');
    expect(r.summary).toBe('thật');
  });

  it('heading thụt lề hoặc có chữ thừa không tính', () => {
    for (const t of [' ## Tổng kết của Trợ Lý\nx', '## Tổng kết của Trợ Lý (nháp)\nx', '#### Tổng kết của Trợ Lý\nx']) {
      expect(splitAssistantSummary(t).summary).toBeNull();
    }
  });

  it('heading rỗng nội dung cho summary rỗng (vẫn có mục)', () => {
    expect(splitAssistantSummary('A\n## Tổng kết của Trợ Lý')).toEqual({ body: 'A', summary: '' });
  });
});
