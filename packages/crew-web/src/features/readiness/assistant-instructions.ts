// AGENTS.md so với bản render kỳ vọng thay vì hash lưu ở setup run: Trợ Lý có danh sách executor (kèm runtime) và
// reviewer Codex trong file nên mỗi lần sửa vai trò file được render lại; vai trò khác được "Render lại" khi template
// đổi giữa hai bản phát hành.
import {
  type AssistantRoles,
  assistantListsOf,
  CREW_ROLE_SLOTS,
  type CrewRoleSlot,
  renderAssistantFor,
  renderInstructions,
  roleOfSlot,
} from '@/lib/instructions';

/** Id agent BMAD trong AGENTS.md hiện có của Trợ Lý; render lại phải giữ nguyên danh sách này. */
export function bmadIdsOf(content: string): string[] {
  return assistantListsOf(content).bmadIds;
}

const SLOTS: readonly string[] = CREW_ROLE_SLOTS.filter((slot) => slot !== 'assistant');

/** AGENTS.md hiện tại của agent vai trò khác Trợ Lý có đúng là bản render từ template hiện tại không. */
export function matchesRoleTemplate(content: string, agentId: string, slot: string): boolean {
  if (!SLOTS.includes(slot)) return false;
  return renderInstructions(roleOfSlot(slot as CrewRoleSlot), { agentId }) === content;
}

/** AGENTS.md hiện tại của Trợ Lý có đúng là bản render từ template với vai trò của project không. */
export function matchesAssistantTemplate(content: string, roles: AssistantRoles): boolean {
  try {
    return renderAssistantFor(roles, content) === content;
  } catch {
    return false; // id không hợp lệ: không thể là bản render
  }
}
