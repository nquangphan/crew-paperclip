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

/** Runtime mà dòng executor được ghi kèm; id trần là `claude_local`. */
export const INSTRUCTION_RUNTIMES = ['claude_local', 'codex_local', 'opencode_local'] as const;
export type InstructionRuntime = (typeof INSTRUCTION_RUNTIMES)[number];

/** Một mục executor là `<uuid>` (claude_local) hoặc `<uuid>:<runtime>`, như đối số của script. */
function parseExecutor(entry: string): { id: string; runtime: InstructionRuntime } {
  const [id = '', ...rest] = entry.split(':');
  if (rest.length === 0) return { id, runtime: 'claude_local' };
  const runtime = rest.join(':');
  if (!(INSTRUCTION_RUNTIMES as readonly string[]).includes(runtime)) {
    throw new Error(`runtime của executor không hợp lệ: ${entry}`);
  }
  return { id, runtime: runtime as InstructionRuntime };
}

/** Như `renderInstructions(role, text, agentId, executorIds, bmadIds, reviewerCodexId)` của script, với `text` cho sẵn. */
export function renderInstructionsText(
  role: InstructionRole,
  text: string,
  agentId: string,
  executorIds: readonly string[],
  bmadIds: readonly string[] = [],
  reviewerCodexId = '',
): string {
  if (!Object.hasOwn(INSTRUCTION_TEMPLATES, role)) throw new Error(`unknown role: ${role}`);
  if (role !== 'assistant') {
    if (executorIds.length > 0) throw new Error('danh sách executor chỉ assistant nhận');
    if (bmadIds.length > 0) throw new Error('danh sách agent BMAD chỉ assistant nhận');
    if (reviewerCodexId !== '') throw new Error('reviewer Codex chỉ assistant nhận');
    return text;
  }
  if (!UUID_RE.test(agentId)) throw new Error(`assistant phải là uuid: ${agentId}`);
  if (executorIds.length === 0) throw new Error('assistant cần ít nhất một executor');
  const parsed = executorIds.map(parseExecutor);
  const executors = checkIds(
    parsed.map((e) => e.id),
    'executor',
    agentId,
    new Set(),
  );
  const bmads = checkIds(bmadIds, 'agent BMAD', agentId, executors);
  const reviewer =
    reviewerCodexId === '' ? 'Không có. Server tự chọn reviewer, bạn không giao việc cho reviewer.' : null;
  if (reviewer === null) checkIds([reviewerCodexId], 'reviewer Codex', agentId, new Set([...executors, ...bmads]));
  const list = parsed.map((e) => `- \`${e.id}\` — runtime \`${e.runtime}\``).join('\n');
  const bmad = bmadIds.length > 0 ? bmadIds.map((id) => `- \`${id}\``).join('\n') : 'Không có. Luôn dùng Superpowers.';
  const reviewerBlock = reviewer ?? `- \`${reviewerCodexId}\` — runtime \`codex_local\``;
  return `${text.replace(/\n*$/, '\n')}\n## Executor của company\n\n${list}\n\n## Agent BMAD của company\n\n${bmad}\n\n## Reviewer Codex của company\n\n${reviewerBlock}\n`;
}

export interface RenderVars {
  /** Id của chính agent nhận file (Trợ Lý cần để chặn tự giao cho mình). */
  agentId: string;
  /** Chỉ Trợ Lý: executor của project, giữ thứ tự; mỗi mục `<id>` (claude_local) hoặc `<id>:<runtime>`. */
  executorIds?: readonly string[];
  /** Chỉ Trợ Lý: id agent BMAD; rỗng thì ghi "Không có. Luôn dùng Superpowers.". */
  bmadIds?: readonly string[];
  /** Chỉ Trợ Lý: reviewer Codex của project; trống thì ghi "Không có. …". */
  reviewerCodexId?: string;
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
    vars.reviewerCodexId ?? '',
  );
}

const EXECUTOR_HEADING = '## Executor của company';
const BMAD_HEADING = '## Agent BMAD của company';
const REVIEWER_CODEX_HEADING = '## Reviewer Codex của company';
const UUID_GLOBAL_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EXECUTOR_LINE_RE =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:`? — runtime `(claude_local|codex_local|opencode_local)`)?/gi;

function sectionText(content: string, heading: string): string {
  // Tiêu đề phải đứng riêng một dòng (kể cả dòng đầu file); lấy lần cuối vì render nối các mục vào cuối file.
  const text = `\n${content}`;
  const start = text.lastIndexOf(`\n${heading}\n`);
  if (start < 0) return '';
  const rest = text.slice(start + heading.length + 2);
  const end = rest.search(/^## /m);
  return end < 0 ? rest : rest.slice(0, end);
}

const sectionIds = (content: string, heading: string): string[] => [
  ...new Set(sectionText(content, heading).match(UUID_GLOBAL_RE) ?? []),
];

export interface AssistantLists {
  executorIds: string[];
  /** Executor kèm runtime; dòng bản cũ không ghi runtime là `claude_local`. */
  executors: { id: string; runtime: InstructionRuntime }[];
  bmadIds: string[];
  reviewerCodexId: string | null;
}

/** Đọc lại các danh sách mà `renderInstructions('assistant', …)` đã nối vào cuối AGENTS.md. */
export function assistantListsOf(content: string): AssistantLists {
  const executors: AssistantLists['executors'] = [];
  for (const match of sectionText(content, EXECUTOR_HEADING).matchAll(EXECUTOR_LINE_RE)) {
    const id = match[1] ?? '';
    if (executors.some((e) => e.id === id)) continue;
    executors.push({ id, runtime: (match[2] as InstructionRuntime | undefined) ?? 'claude_local' });
  }
  return {
    executorIds: executors.map((e) => e.id),
    executors,
    bmadIds: sectionIds(content, BMAD_HEADING),
    reviewerCodexId: sectionIds(content, REVIEWER_CODEX_HEADING)[0] ?? null,
  };
}

/** Vai trò project mà AGENTS.md của Trợ Lý phản ánh; ô runtime thiếu (plugin cũ) hay null là trống. */
export interface AssistantRoles {
  assistantAgentId: string;
  executorAgentIds: readonly string[];
  codexExecutorAgentId?: string | null;
  opencodeExecutorAgentId?: string | null;
  codexReviewerAgentId?: string | null;
}

/** Mục executor cho script: executor Claude (id trần), rồi executor Codex, OpenCode. */
export function assistantEntriesOf(roles: AssistantRoles): string[] {
  return [
    ...roles.executorAgentIds,
    ...(roles.codexExecutorAgentId ? [`${roles.codexExecutorAgentId}:codex_local`] : []),
    ...(roles.opencodeExecutorAgentId ? [`${roles.opencodeExecutorAgentId}:opencode_local`] : []),
  ];
}

/**
 * AGENTS.md của Trợ Lý theo vai trò project. Agent BMAD lấy từ file hiện có (`current`, rỗng nếu chưa có), bỏ id đã
 * thành Trợ Lý, executor hay reviewer Codex.
 */
export function renderAssistantFor(roles: AssistantRoles, current: string): string {
  const entries = assistantEntriesOf(roles);
  const taken = new Set(
    [roles.assistantAgentId, ...entries.map((e) => parseExecutor(e).id), roles.codexReviewerAgentId ?? ''].map((id) =>
      id.toLowerCase(),
    ),
  );
  return renderInstructions('assistant', {
    agentId: roles.assistantAgentId,
    executorIds: entries,
    bmadIds: assistantListsOf(current).bmadIds.filter((id) => !taken.has(id.toLowerCase())),
    reviewerCodexId: roles.codexReviewerAgentId ?? '',
  });
}

/** Danh sách executor (kèm runtime) và reviewer Codex trong file Trợ Lý đã khớp vai trò project chưa. */
export function assistantListsMatch(content: string, roles: AssistantRoles): boolean {
  const lists = assistantListsOf(content);
  const want = assistantEntriesOf(roles).map(parseExecutor);
  const same = (a: string | null | undefined, b: string | null | undefined) =>
    (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
  return (
    lists.executors.length === want.length &&
    lists.executors.every((e, i) => same(e.id, want[i]?.id) && e.runtime === want[i]?.runtime) &&
    same(lists.reviewerCodexId, roles.codexReviewerAgentId)
  );
}
