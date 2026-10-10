import { describe, expect, it } from 'vitest';
import {
  assistantEntriesOf,
  assistantListsMatch,
  assistantListsOf,
  renderAssistantFor,
  renderInstructions,
} from '@/lib/instructions';

const A = '11111111-1111-4111-8111-111111111111';
const E1 = '22222222-2222-4222-8222-222222222222';
const E2 = '33333333-3333-4333-8333-333333333333';
const B1 = '44444444-4444-4444-8444-444444444444';
const E3 = '55555555-5555-4555-8555-555555555555';
const R1 = '66666666-6666-4666-8666-666666666666';
const claude = (id: string) => ({ id, runtime: 'claude_local' });
const roles = {
  assistantAgentId: A,
  executorAgentIds: [E1],
  reviewerAgentId: '77777777-7777-4777-8777-777777777777',
  integratorAgentId: '88888888-8888-4888-8888-888888888888',
  codexExecutorAgentId: E2,
  opencodeExecutorAgentId: E3,
  codexReviewerAgentId: R1,
};

describe('assistantListsOf', () => {
  it('đọc lại đúng danh sách executor và BMAD đã render, giữ thứ tự', () => {
    const content = renderInstructions('assistant', { agentId: A, executorIds: [E2, E1], bmadIds: [B1] });
    expect(assistantListsOf(content)).toEqual({
      executorIds: [E2, E1],
      executors: [claude(E2), claude(E1)],
      bmadIds: [B1],
      reviewerCodexId: null,
    });
  });

  it('không có agent BMAD → danh sách rỗng', () => {
    const content = renderInstructions('assistant', { agentId: A, executorIds: [E1] });
    expect(assistantListsOf(content)).toEqual({
      executorIds: [E1],
      executors: [claude(E1)],
      bmadIds: [],
      reviewerCodexId: null,
    });
  });

  it('file không có mục nào (agent khác vai trò, file trống) → rỗng', () => {
    const empty = { executorIds: [], executors: [], bmadIds: [], reviewerCodexId: null };
    expect(assistantListsOf(renderInstructions('executor', { agentId: E1 }))).toEqual(empty);
    expect(assistantListsOf('')).toEqual(empty);
  });

  it('đọc runtime từng executor và reviewer Codex', () => {
    const content = renderInstructions('assistant', {
      agentId: A,
      executorIds: [E1, `${E2}:codex_local`, `${E3}:opencode_local`],
      bmadIds: [B1],
      reviewerCodexId: R1,
    });
    expect(assistantListsOf(content)).toEqual({
      executorIds: [E1, E2, E3],
      executors: [claude(E1), { id: E2, runtime: 'codex_local' }, { id: E3, runtime: 'opencode_local' }],
      bmadIds: [B1],
      reviewerCodexId: R1,
    });
  });

  it('file bản cũ (dòng executor chưa có runtime) coi là claude_local', () => {
    const old = `# Trợ Lý\n\n## Executor của company\n\n- \`${E1}\`\n\n## Agent BMAD của company\n\nKhông có.\n`;
    expect(assistantListsOf(old)).toEqual({
      executorIds: [E1],
      executors: [claude(E1)],
      bmadIds: [],
      reviewerCodexId: null,
    });
  });
});

describe('render AGENTS.md của Trợ Lý theo vai trò project', () => {
  it('executor Claude trước, rồi executor Codex, OpenCode; reviewer Codex ở mục riêng', () => {
    expect(assistantEntriesOf(roles)).toEqual([E1, `${E2}:codex_local`, `${E3}:opencode_local`]);
    expect(renderAssistantFor(roles, '')).toBe(
      renderInstructions('assistant', {
        agentId: A,
        executorIds: [E1, `${E2}:codex_local`, `${E3}:opencode_local`],
        reviewerCodexId: R1,
      }),
    );
  });

  it('ô runtime trống hoặc không có (plugin cũ) thì bỏ', () => {
    const plain = { assistantAgentId: A, executorAgentIds: [E1, E2], reviewerAgentId: R1, integratorAgentId: B1 };
    expect(assistantEntriesOf(plain)).toEqual([E1, E2]);
    expect(assistantEntriesOf({ ...plain, codexExecutorAgentId: null, codexReviewerAgentId: null })).toEqual([E1, E2]);
    expect(renderAssistantFor(plain, '')).toBe(renderInstructions('assistant', { agentId: A, executorIds: [E1, E2] }));
  });

  it('giữ agent BMAD của file hiện có, bỏ id đã thành executor hay reviewer Codex', () => {
    const current = renderInstructions('assistant', { agentId: A, executorIds: [E1], bmadIds: [B1, E2] });
    expect(assistantListsOf(renderAssistantFor(roles, current)).bmadIds).toEqual([B1]);
    // Agent BMAD cũ vừa thành Trợ Lý.
    const promoted = renderInstructions('assistant', { agentId: E3, executorIds: [E1], bmadIds: [B1] });
    expect(() =>
      renderAssistantFor({ ...roles, assistantAgentId: B1, opencodeExecutorAgentId: null }, promoted),
    ).not.toThrow();
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

  it('so danh sách trong file với vai trò: đủ executor kèm runtime và reviewer Codex mới khớp', () => {
    const content = renderAssistantFor(roles, '');
    expect(assistantListsMatch(content, roles)).toBe(true);
    expect(assistantListsMatch(content, { ...roles, codexReviewerAgentId: null })).toBe(false);
    expect(assistantListsMatch(content, { ...roles, opencodeExecutorAgentId: null })).toBe(false);
    // Cùng id nhưng runtime khác (file cũ ghi E2 là claude_local).
    const old = renderInstructions('assistant', { agentId: A, executorIds: [E1, E2, E3], reviewerCodexId: R1 });
    expect(assistantListsMatch(old, roles)).toBe(false);
    expect(assistantListsMatch('', { assistantAgentId: A, executorAgentIds: [] })).toBe(true);
  });
});
