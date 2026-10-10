import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INSTRUCTION_TEMPLATES, type InstructionRole, renderInstructions } from '@/lib/instructions';

const FORK = resolve(import.meta.dirname, '../../../../..');
const SCRIPT = resolve(FORK, 'crew/agents/render-instructions.mjs');
const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dirname, `__fixtures__/rendered/${name}.md`), 'utf8');

const A = '11111111-1111-4111-8111-111111111111';
const E1 = '22222222-2222-4222-8222-222222222222';
const E2 = '33333333-3333-4333-8333-333333333333';
const B1 = '44444444-4444-4444-8444-444444444444';
const E3 = '55555555-5555-4555-8555-555555555555';
const R1 = '66666666-6666-4666-8666-666666666666';

/** Chạy script gốc của fork với đúng tham số CLI của nó, trả `content`. */
function script(
  role: InstructionRole,
  agentId: string,
  executors: string[] = [],
  bmad: string[] = [],
  reviewerCodex = '',
): string {
  const out = execFileSync(
    'node',
    [
      SCRIPT,
      role,
      resolve(FORK, `crew/agents/${role}.md`),
      agentId,
      executors.join(','),
      bmad.join(','),
      reviewerCodex,
    ],
    { encoding: 'utf8' },
  );
  const parsed = JSON.parse(out) as { path: string; content: string };
  expect(parsed.path).toBe('AGENTS.md');
  return parsed.content;
}

const CASES: { name: string; role: InstructionRole; executors: string[]; bmad: string[]; reviewerCodex?: string }[] = [
  { name: 'assistant', role: 'assistant', executors: [E1, E2], bmad: [] },
  { name: 'assistant-bmad', role: 'assistant', executors: [E1], bmad: [B1] },
  {
    name: 'assistant-runtimes',
    role: 'assistant',
    executors: [E1, `${E2}:codex_local`, `${E3}:opencode_local`],
    bmad: [B1],
    reviewerCodex: R1,
  },
  { name: 'executor', role: 'executor', executors: [], bmad: [] },
  { name: 'reviewer', role: 'reviewer', executors: [], bmad: [] },
  { name: 'integrator', role: 'integrator', executors: [], bmad: [] },
  { name: 'bmad', role: 'bmad', executors: [], bmad: [] },
];

describe('renderInstructions', () => {
  for (const c of CASES) {
    const vars = { agentId: A, executorIds: c.executors, bmadIds: c.bmad, reviewerCodexId: c.reviewerCodex };
    it(`render ${c.name} khớp từng byte fixture sinh từ render-instructions.mjs`, () => {
      expect(renderInstructions(c.role, vars)).toBe(fixture(c.name));
    });

    it(`render ${c.name} khớp từng byte script gốc chạy trên template hiện tại`, () => {
      expect(renderInstructions(c.role, vars)).toBe(script(c.role, A, c.executors, c.bmad, c.reviewerCodex));
    });
  }

  it('template import ?raw trùng từng byte crew/agents/*.md của fork', () => {
    for (const role of Object.keys(INSTRUCTION_TEMPLATES) as InstructionRole[]) {
      expect(INSTRUCTION_TEMPLATES[role]).toBe(readFileSync(resolve(FORK, `crew/agents/${role}.md`), 'utf8'));
    }
  });

  it('template Trợ Lý có các mục của bản mới nhất', () => {
    const text = INSTRUCTION_TEMPLATES.assistant;
    expect(text).toContain('## Chọn workflow');
    expect(text).toContain('## Chốt trạng thái gốc');
    expect(renderInstructions('assistant', { agentId: A, executorIds: [E1] })).toContain(
      '\n## Agent BMAD của company\n\nKhông có. Luôn dùng Superpowers.\n',
    );
  });

  it('từ chối đầu vào sai với cùng câu lỗi như script', () => {
    expect(() => renderInstructions('assistant', { agentId: A, executorIds: [] })).toThrow(
      'assistant cần ít nhất một executor',
    );
    expect(() => renderInstructions('assistant', { agentId: 'abc', executorIds: [E1] })).toThrow(
      'assistant phải là uuid: abc',
    );
    expect(() => renderInstructions('assistant', { agentId: A, executorIds: ['abc'] })).toThrow(
      'executor phải là uuid: abc',
    );
    expect(() => renderInstructions('assistant', { agentId: A, executorIds: [E1, E1.toUpperCase()] })).toThrow(
      `executor trùng: ${E1.toUpperCase()}`,
    );
    expect(() => renderInstructions('assistant', { agentId: A, executorIds: [A] })).toThrow(
      'Trợ Lý không được nằm trong danh sách executor của chính nó',
    );
    expect(() => renderInstructions('assistant', { agentId: A, executorIds: [E1], bmadIds: [E1] })).toThrow(
      `agent BMAD trùng: ${E1}`,
    );
    expect(() => renderInstructions('reviewer', { agentId: A, executorIds: [E1] })).toThrow(
      'danh sách executor chỉ assistant nhận',
    );
    expect(() => renderInstructions('executor', { agentId: A, bmadIds: [B1] })).toThrow(
      'danh sách agent BMAD chỉ assistant nhận',
    );
    expect(() => renderInstructions('owner' as InstructionRole, { agentId: A })).toThrow('unknown role: owner');
    expect(() => renderInstructions('assistant', { agentId: A, executorIds: [`${E1}:claude`] })).toThrow(
      `runtime của executor không hợp lệ: ${E1}:claude`,
    );
    expect(() => renderInstructions('assistant', { agentId: A, executorIds: [E1, `${E1}:codex_local`] })).toThrow(
      `executor trùng: ${E1}`,
    );
    expect(() => renderInstructions('assistant', { agentId: A, executorIds: [E1], reviewerCodexId: E1 })).toThrow(
      `reviewer Codex trùng: ${E1}`,
    );
    expect(() => renderInstructions('assistant', { agentId: A, executorIds: [E1], reviewerCodexId: 'x' })).toThrow(
      'reviewer Codex phải là uuid: x',
    );
    expect(() => renderInstructions('reviewer', { agentId: A, reviewerCodexId: R1 })).toThrow(
      'reviewer Codex chỉ assistant nhận',
    );
  });

  it('vai không phải assistant trả nguyên template, không cần agentId hợp lệ', () => {
    expect(renderInstructions('integrator', { agentId: '' })).toBe(INSTRUCTION_TEMPLATES.integrator);
  });
});
