// Tạo yêu cầu mới: POST issue rồi upload đính kèm lần lượt. Không gửi policy, reviewer, approver (server tự gắn theo vai trò project).
import type { Issue } from '@paperclipai/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '@/api';
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

export function buildCreateBody(input: CreateRequestInput): Record<string, unknown> {
  const description = input.description.trim();
  const body: Record<string, unknown> = {
    title: input.title.trim(),
    ...(description ? { description } : {}),
    projectId: input.projectId,
    assigneeAgentId: input.assigneeAgentId,
    status: input.draft ? 'backlog' : 'todo',
  };
  if (input.kind === 'research') {
    if (!input.researchLabelId) throw new Error('Thiếu nhãn research cho yêu cầu Nghiên cứu');
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

/** Id nhãn `research` của company. Không có nhãn này thì null và dialog ẩn loại Nghiên cứu. */
export function useResearchLabelId(companyId: string) {
  return useQuery({
    queryKey: ['issues', companyId, 'research-label'],
    enabled: companyId !== '',
    queryFn: async (): Promise<string | null> => findResearchLabelId(await api.labels.list(companyId)),
  });
}
