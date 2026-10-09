// Đường dẫn trong company cho link của feature agent (feature không import từ app).
export { companyHref, resumeHref } from '@/features/projects/paths';

export const agentRef = (agent: { id: string; urlKey?: string | null }): string => agent.urlKey || agent.id;
