// Đường dẫn trong company cho link của feature agent (feature không import từ app).
export { companyHref } from '@/features/projects/paths';
export { resumeHref } from '@/features/wizards';

export const agentRef = (agent: { id: string; urlKey?: string | null }): string => agent.urlKey || agent.id;
