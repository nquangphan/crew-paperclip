// AGENTS.md so với bản render kỳ vọng thay vì hash lưu ở setup run: Trợ Lý có danh sách executor trong file nên mỗi
// lần sửa vai trò file được render lại; vai trò khác được "Render lại" khi template đổi giữa hai bản phát hành.
import { assistantListsOf, type CrewRoleSlot, renderInstructions, roleOfSlot } from '@/lib/instructions';

/** Id agent BMAD trong AGENTS.md hiện có của Trợ Lý; render lại phải giữ nguyên danh sách này. */
export function bmadIdsOf(content: string): string[] {
  return assistantListsOf(content).bmadIds;
}

const SLOTS: readonly string[] = ['executor', 'executor-2', 'reviewer', 'integrator'];

/** AGENTS.md hiện tại của agent vai trò khác Trợ Lý có đúng là bản render từ template hiện tại không. */
export function matchesRoleTemplate(content: string, agentId: string, slot: string): boolean {
  if (!SLOTS.includes(slot)) return false;
  return renderInstructions(roleOfSlot(slot as CrewRoleSlot), { agentId }) === content;
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
