// AGENTS.md của Trợ Lý: danh sách executor nằm trong file, nên mỗi lần sửa vai trò file được render lại và hash lưu ở
// setup run lỗi thời. Readiness so nội dung hiện tại với bản render kỳ vọng thay vì hash cũ.
import { renderInstructions } from '@/lib/instructions';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const BMAD_HEADING = '## Agent BMAD của company';

/** Id agent BMAD trong AGENTS.md hiện có của Trợ Lý; render lại phải giữ nguyên danh sách này. */
export function bmadIdsOf(content: string): string[] {
  const start = content.indexOf(BMAD_HEADING);
  if (start < 0) return [];
  const rest = content.slice(start + BMAD_HEADING.length);
  const end = rest.search(/^## /m);
  const section = end < 0 ? rest : rest.slice(0, end);
  return [...new Set(section.match(UUID_RE) ?? [])];
}

/** AGENTS.md hiện tại của Trợ Lý có đúng là bản render từ template với executor của project không. */
export function matchesAssistantTemplate(content: string, agentId: string, executorIds: readonly string[]): boolean {
  const executors = new Set(executorIds.map((id) => id.toLowerCase()));
  try {
    return (
      renderInstructions('assistant', {
        agentId,
        executorIds: [...executorIds],
        bmadIds: bmadIdsOf(content).filter((id) => !executors.has(id.toLowerCase())),
      }) === content
    );
  } catch {
    return false; // id không hợp lệ: không thể là bản render
  }
}
