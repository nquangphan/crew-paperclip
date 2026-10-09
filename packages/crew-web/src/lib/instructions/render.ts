// Bản port TypeScript của crew/agents/render-instructions.mjs (fork). Kết quả phải trùng từng byte với script:
// test/lib/instructions/render.test.ts chạy script gốc để so. Câu lỗi giữ nguyên văn như script.
import { INSTRUCTION_TEMPLATES, type InstructionRole } from './templates';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function checkIds(ids: readonly string[], label: string, agentId: string, taken: Set<string>): Set<string> {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!UUID_RE.test(id)) throw new Error(`${label} phải là uuid: ${id}`);
    const key = id.toLowerCase();
    if (seen.has(key) || taken.has(key)) throw new Error(`${label} trùng: ${id}`);
    if (key === agentId.toLowerCase()) throw new Error(`Trợ Lý không được nằm trong danh sách ${label} của chính nó`);
    seen.add(key);
  }
  return seen;
}

/** Như `renderInstructions(role, text, agentId, executorIds, bmadIds)` của script, với `text` cho sẵn. */
export function renderInstructionsText(
  role: InstructionRole,
  text: string,
  agentId: string,
  executorIds: readonly string[],
  bmadIds: readonly string[] = [],
): string {
  if (!Object.hasOwn(INSTRUCTION_TEMPLATES, role)) throw new Error(`unknown role: ${role}`);
  if (role !== 'assistant') {
    if (executorIds.length > 0) throw new Error('danh sách executor chỉ assistant nhận');
    if (bmadIds.length > 0) throw new Error('danh sách agent BMAD chỉ assistant nhận');
    return text;
  }
  if (!UUID_RE.test(agentId)) throw new Error(`assistant phải là uuid: ${agentId}`);
  if (executorIds.length === 0) throw new Error('assistant cần ít nhất một executor');
  const executors = checkIds(executorIds, 'executor', agentId, new Set());
  checkIds(bmadIds, 'agent BMAD', agentId, executors);
  const list = executorIds.map((id) => `- \`${id}\``).join('\n');
  const bmad = bmadIds.length > 0 ? bmadIds.map((id) => `- \`${id}\``).join('\n') : 'Không có. Luôn dùng Superpowers.';
  return `${text.replace(/\n*$/, '\n')}\n## Executor của company\n\n${list}\n\n## Agent BMAD của company\n\n${bmad}\n`;
}

export interface RenderVars {
  /** Id của chính agent nhận file (Trợ Lý cần để chặn tự giao cho mình). */
  agentId: string;
  /** Chỉ Trợ Lý: id executor của project, giữ thứ tự. */
  executorIds?: readonly string[];
  /** Chỉ Trợ Lý: id agent BMAD; rỗng thì ghi "Không có. Luôn dùng Superpowers.". */
  bmadIds?: readonly string[];
}

/** Render `AGENTS.md` của một vai trò từ template gốc của fork. */
export function renderInstructions(role: InstructionRole, vars: RenderVars): string {
  if (!Object.hasOwn(INSTRUCTION_TEMPLATES, role)) throw new Error(`unknown role: ${role}`);
  return renderInstructionsText(
    role,
    INSTRUCTION_TEMPLATES[role],
    vars.agentId,
    vars.executorIds ?? [],
    vars.bmadIds ?? [],
  );
}

const EXECUTOR_HEADING = '## Executor của company';
const BMAD_HEADING = '## Agent BMAD của company';
const UUID_GLOBAL_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function sectionIds(content: string, heading: string): string[] {
  const start = content.lastIndexOf(`\n${heading}\n`);
  if (start < 0) return [];
  const rest = content.slice(start + heading.length + 2);
  const end = rest.search(/^## /m);
  return [...new Set((end < 0 ? rest : rest.slice(0, end)).match(UUID_GLOBAL_RE) ?? [])];
}

/** Đọc lại danh sách executor và agent BMAD mà `renderInstructions('assistant', …)` đã nối vào cuối AGENTS.md. */
export function assistantListsOf(content: string): { executorIds: string[]; bmadIds: string[] } {
  return { executorIds: sectionIds(content, EXECUTOR_HEADING), bmadIds: sectionIds(content, BMAD_HEADING) };
}
