// Tạo yêu cầu mới: POST issue rồi upload đính kèm lần lượt. Không gửi policy, reviewer, approver (server tự gắn theo vai trò project).
import type { Issue } from '@paperclipai/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, queryKeys } from '@/api';
import { getI18n } from '@/i18n';
import { findResearchLabelId, type RequestKind } from './kinds';

export interface CreateRequestInput {
  companyId: string;
  title: string;
  description: string;
  projectId: string;
  /** Trợ Lý của project (roles.assistantAgentId). */
  assigneeAgentId: string;
  kind: RequestKind;
  researchLabelId: string | null;
  /** true: lưu nháp (backlog, chưa đánh thức agent). */
  draft: boolean;
  files: File[];
}

export interface CreateRequestResult {
  issue: Issue;
  /** Tên file upload lỗi; issue vẫn đã tạo. */
  failedUploads: string[];
}

/** Trường dựng body tạo issue; dùng chung cho dialog Yêu cầu mới và bước đăng khi owner duyệt góp ý. */
export type CreateBodyInput = Pick<
  CreateRequestInput,
  'title' | 'description' | 'projectId' | 'assigneeAgentId' | 'kind' | 'researchLabelId' | 'draft'
> & {
  /** Khóa idempotent của route stock: gọi lại cùng khóa thì server trả issue cũ, không tạo bản trùng. */
  idempotencyKey?: string;
  /**
   * true: tạo issue mới kể cả khi đã có issue mở cùng tiêu đề trong 48 giờ (mặc định stock là trả lại issue cũ).
   * Duyệt góp ý cần cờ này để nội dung owner đã duyệt không bị bỏ; khóa idempotent vẫn chặn bản trùng khi gọi lại.
   */
  allowDuplicate?: boolean;
};

export function buildCreateBody(input: CreateBodyInput): Record<string, unknown> {
  // Mô tả chỉ trim để kiểm rỗng; gửi nguyên văn để markdown mở đầu bằng khối thụt lề không hỏng.
  const description = input.description.trim() ? input.description : null;
  const body: Record<string, unknown> = {
    title: input.title.trim(),
    ...(description !== null ? { description } : {}),
    projectId: input.projectId,
    assigneeAgentId: input.assigneeAgentId,
    status: input.draft ? 'backlog' : 'todo',
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    ...(input.allowDuplicate ? { allowDuplicate: true } : {}),
  };
  if (input.kind === 'research') {
    if (!input.researchLabelId) throw new Error(getI18n().t('new.researchMissing', { ns: 'issues' }));
    body.labelIds = [input.researchLabelId];
  }
  return body;
}

export async function createRequest(input: CreateRequestInput): Promise<CreateRequestResult> {
  const issue = await api.issues.create(input.companyId, buildCreateBody(input));
  const failedUploads: string[] = [];
  for (const file of input.files) {
    try {
      await api.attachments.upload(input.companyId, issue.id, file);
    } catch {
      failedUploads.push(file.name);
    }
  }
  return { issue, failedUploads };
}

export function useCreateRequest(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateRequestInput, 'companyId'>) => createRequest({ ...input, companyId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues(companyId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(companyId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.crew('crew.roots') });
    },
  });
}

/** Id nhãn `research` của company (dùng chung cache nhãn). Không có nhãn này thì null và dialog ẩn loại Nghiên cứu. */
export function useResearchLabelId(companyId: string) {
  return useQuery({
    queryKey: queryKeys.labels(companyId),
    enabled: companyId !== '',
    queryFn: () => api.labels.list(companyId),
    select: findResearchLabelId,
  });
}

/** Vai trò project; 404 nghĩa là project chưa có dòng vai trò (chưa có Trợ Lý) nên trả null. */
export async function projectRolesOrNull(companyId: string, projectId: string) {
  try {
    return await api.roles.get(companyId, projectId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
