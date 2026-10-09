import { describe, expect, it } from 'vitest';
import { assistantListsOf, renderInstructions } from '@/lib/instructions';

const A = '11111111-1111-4111-8111-111111111111';
const E1 = '22222222-2222-4222-8222-222222222222';
const E2 = '33333333-3333-4333-8333-333333333333';
const B1 = '44444444-4444-4444-8444-444444444444';

describe('assistantListsOf', () => {
  it('đọc lại đúng danh sách executor và BMAD đã render, giữ thứ tự', () => {
    const content = renderInstructions('assistant', { agentId: A, executorIds: [E2, E1], bmadIds: [B1] });
    expect(assistantListsOf(content)).toEqual({ executorIds: [E2, E1], bmadIds: [B1] });
  });

  it('không có agent BMAD → danh sách rỗng', () => {
    const content = renderInstructions('assistant', { agentId: A, executorIds: [E1] });
    expect(assistantListsOf(content)).toEqual({ executorIds: [E1], bmadIds: [] });
  });

  it('file không có mục nào (agent khác vai trò, file trống) → rỗng', () => {
    expect(assistantListsOf(renderInstructions('executor', { agentId: E1 }))).toEqual({ executorIds: [], bmadIds: [] });
    expect(assistantListsOf('')).toEqual({ executorIds: [], bmadIds: [] });
  });
});

describe('bmadIdsOf của readiness', () => {
  it('đọc giống assistantListsOf khi tiêu đề mục BMAD xuất hiện cả trong thân file', async () => {
    const { bmadIdsOf } = await import('@/features/readiness/assistant-instructions');
    const rendered = renderInstructions('assistant', { agentId: A, executorIds: [E1], bmadIds: [B1] });
    const content = `Ghi chú: mục "## Agent BMAD của company" ở cuối, ví dụ ${E2}.\n${rendered}`;
    expect(bmadIdsOf(content)).toEqual(assistantListsOf(content).bmadIds);
    expect(bmadIdsOf(content)).toEqual([B1]);
  });
});
