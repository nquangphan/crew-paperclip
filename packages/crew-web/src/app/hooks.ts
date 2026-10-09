// Hook cho feature: company đang xem, người dùng hiện tại, sự kiện trực tiếp.
import type { AuthSession, Company } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { api, queryKeys } from '@/api';

export { useLiveEvents } from './live/live-events';

export interface CompanyRef {
  id: string;
  name: string;
  issuePrefix: string;
}

export interface Me {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

export const CompanyContext = createContext<{ company: CompanyRef; companies: CompanyRef[] } | null>(null);
export const MeContext = createContext<Me | null>(null);

/** Company đang xem (theo /:companyPrefix) và danh sách company Crew. Chỉ dùng bên trong shell. */
export function useCompany(): { company: CompanyRef; companies: CompanyRef[] } {
  const value = useContext(CompanyContext);
  if (!value) throw new Error('useCompany chỉ dùng bên trong shell company');
  return value;
}

/** Người dùng đã đăng nhập. Chỉ dùng bên trong RequireSession. */
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe chỉ dùng sau khi đã đăng nhập');
  return me;
}

export function useSession() {
  return useQuery({ queryKey: queryKeys.session, queryFn: () => api.auth.session(), retry: false, staleTime: 60_000 });
}

export function toMe(session: AuthSession): Me {
  return {
    id: session.user.id,
    name: session.user.name ?? null,
    email: session.user.email ?? null,
    image: session.user.image ?? null,
  };
}

const toRef = (c: Pick<Company, 'id' | 'name' | 'issuePrefix'>): CompanyRef => ({
  id: c.id,
  name: c.name,
  issuePrefix: c.issuePrefix,
});

/**
 * Company hiện trong UI: company người dùng vào được (GET /companies) giao với company có cấu hình Crew
 * (data crew.companies, gọi riêng từng company kèm companyId). Company không có trong cấu hình Crew (ví dụ spike)
 * không hiện.
 */
export function useCrewCompanies() {
  const all = useQuery({ queryKey: queryKeys.companies, queryFn: () => api.companies.list(), staleTime: 60_000 });
  const ids = (all.data ?? []).map((c) => c.id);
  const crew = useQuery({
    queryKey: [...queryKeys.crewCompanies, ids],
    queryFn: () => api.crew.companies(ids),
    enabled: !!all.data,
    staleTime: 60_000,
  });
  const allowed = new Set((crew.data ?? []).map((c) => c.id));
  const companies = all.data && crew.data ? all.data.filter((c) => allowed.has(c.id)).map(toRef) : [];
  return {
    companies,
    isLoading: all.isLoading || (!!all.data && crew.isPending),
    error: all.error ?? crew.error ?? null,
    refetch: () => {
      void all.refetch();
      void crew.refetch();
    },
  };
}

export function findCompany(companies: CompanyRef[], prefix: string | undefined): CompanyRef | null {
  if (!prefix) return null;
  const p = prefix.toUpperCase();
  return companies.find((c) => c.issuePrefix.toUpperCase() === p) ?? null;
}
