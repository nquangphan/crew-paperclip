import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CompanyInvite, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { type ApproveOutcome, approveJoin, type PendingJoin, pendingJoins } from './members-model';

/** Danh sách thành viên đang hoạt động. */
export function useMembers() {
  const { company } = useCompany();
  return useQuery({
    queryKey: queryKeys.members(company.id),
    queryFn: async () => (await api.members.members(company.id)).filter((m) => m.status === 'active'),
  });
}

/** Người đang mang dấu Phòng Marketing. */
export function useContributorIds() {
  const { company } = useCompany();
  return useQuery({
    queryKey: queryKeys.contributors(company.id),
    queryFn: async () => new Set((await api.contributions.contributors(company.id)).map((c) => c.userId)),
  });
}

/** Quyền xem project của mọi thành viên và danh sách project đang dùng để chọn (chỉ owner). */
export function useProjectAccess() {
  const { company } = useCompany();
  const qc = useQueryClient();
  const access = useQuery({
    queryKey: queryKeys.projectAccessAll(company.id),
    queryFn: async () => new Map((await api.projectAccess.list(company.id)).map((a) => [a.userId, a])),
  });
  const projects = useQuery({
    queryKey: queryKeys.projects(company.id),
    queryFn: () => api.projects.list(company.id),
  });
  const save = useMutation({
    mutationFn: ({ userId, projectIds }: { userId: string; projectIds: string[] }) =>
      api.projectAccess.set(company.id, userId, projectIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-access', company.id] }),
  });
  const choices = (projects.data ?? []).filter((p) => !p.archivedAt).map((p) => ({ id: p.id, name: p.name }));
  return { access, projects, choices, save };
}

/** Mọi lời mời (để nối với yêu cầu tham gia); `active` là phần còn hiệu lực. */
export function useInvites() {
  const { company } = useCompany();
  const query = useQuery({
    queryKey: queryKeys.invites(company.id),
    queryFn: () => api.invites.listAll(company.id),
  });
  const active: CompanyInvite[] = (query.data ?? []).filter((i) => i.state === 'active');
  return { ...query, all: query.data ?? [], active };
}

/** Yêu cầu tham gia đang chờ duyệt, đã nối với lời mời. */
export function usePendingJoins(invites: CompanyInvite[]) {
  const { company } = useCompany();
  const query = useQuery({
    queryKey: queryKeys.joinRequests(company.id),
    queryFn: () => api.joinRequests.list(company.id, 'pending_approval'),
  });
  const joins: PendingJoin[] = pendingJoins(query.data ?? [], invites);
  return { ...query, joins };
}

/** Các thao tác ghi của trang; mỗi thao tác làm mới đúng các danh sách bị ảnh hưởng. */
export function useMemberActions() {
  const { company } = useCompany();
  const qc = useQueryClient();
  const refresh = (...keys: (readonly unknown[])[]) =>
    Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));

  const createInvite = useMutation({
    mutationFn: (projectIds: string[]) => api.invites.createContributor(company.id, projectIds),
    onSuccess: () => refresh(queryKeys.invites(company.id)),
  });
  const revokeInvite = useMutation({
    mutationFn: (inviteId: string) => api.invites.revoke(inviteId),
    onSuccess: () => refresh(queryKeys.invites(company.id)),
  });
  const approve = useMutation<ApproveOutcome, Error, PendingJoin>({
    mutationFn: (join) =>
      approveJoin(join, {
        approve: (id) => api.joinRequests.approve(company.id, id),
        enableContributor: (userId) => api.contributions.enableContributor(company.id, userId),
        setProjectAccess: (userId, projectIds) => api.projectAccess.set(company.id, userId, projectIds),
      }),
    onSettled: () =>
      refresh(
        queryKeys.joinRequests(company.id),
        queryKeys.members(company.id),
        queryKeys.contributors(company.id),
        queryKeys.invites(company.id),
        ['project-access', company.id],
      ),
  });
  const reject = useMutation({
    mutationFn: (requestId: string) => api.joinRequests.reject(company.id, requestId),
    onSuccess: () => refresh(queryKeys.joinRequests(company.id), queryKeys.invites(company.id)),
  });
  const enable = useMutation({
    mutationFn: (userId: string) => api.contributions.enableContributor(company.id, userId),
    onSuccess: () => refresh(queryKeys.contributors(company.id)),
  });
  const disable = useMutation({
    mutationFn: (userId: string) => api.contributions.disableContributor(company.id, userId),
    onSuccess: () => refresh(queryKeys.contributors(company.id)),
  });

  return { createInvite, revokeInvite, approve, reject, enable, disable };
}
