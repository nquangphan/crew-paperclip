// Template AGENTS.md theo vai trò: bản gốc là crew/agents/*.md của fork, nhúng nguyên văn lúc build bằng `?raw`.
import assistant from '../../../../../crew/agents/assistant.md?raw';
import bmad from '../../../../../crew/agents/bmad.md?raw';
import executor from '../../../../../crew/agents/executor.md?raw';
import integrator from '../../../../../crew/agents/integrator.md?raw';
import reviewer from '../../../../../crew/agents/reviewer.md?raw';

export type InstructionRole = 'assistant' | 'executor' | 'reviewer' | 'integrator' | 'bmad';

export const INSTRUCTION_TEMPLATES: Readonly<Record<InstructionRole, string>> = Object.freeze({
  assistant,
  executor,
  reviewer,
  integrator,
  bmad,
});
