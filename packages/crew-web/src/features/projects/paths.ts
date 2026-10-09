// Đường dẫn trong company cho link của feature project (feature không import từ app).
export const companyHref = (prefix: string, to: string): string =>
  `/${encodeURIComponent(prefix)}/${to.replace(/^\//, '')}`;

export const projectRef = (project: { id: string; urlKey?: string | null }): string => project.urlKey || project.id;

/** Lối "Làm tiếp" vào wizard: do feature wizards dựng (run dở thì chạy tiếp, không thì chế độ sửa). */
export { resumeHref } from '@/features/wizards';
