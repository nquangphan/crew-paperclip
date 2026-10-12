// Danh sách hình của trang Hướng dẫn. Ảnh chụp thật từ stack T1 bằng `e2e/specs/guide-shots.spec.ts` (lệnh
// `pnpm --filter @crew/paperclip-web guide:shots`), lưu `img/<lang>/<id>.webp` hoặc `img/<lang>/<id>.<vai trò>.webp`
// khi màn hình khác nhau theo vai trò. Sơ đồ vẽ tay ở `img/<lang>/<id>.svg`. Chú thích ở locale `shots.<id>`.
import type { GuideRole } from './guide-roles';

export interface GuideShot {
  id: string;
  /** `shot`: ảnh chụp màn hình thật. `diagram`: sơ đồ minh họa, không phải ảnh chụp. */
  kind: 'shot' | 'diagram';
  /** Vai trò có ảnh riêng. Không có: một ảnh chung cho mọi vai trò. */
  roles?: readonly GuideRole[];
}

const ALL: readonly GuideRole[] = ['owner', 'operator', 'viewer', 'contributor'];
const shot = (id: string, roles?: readonly GuideRole[]): GuideShot => ({
  id,
  kind: 'shot',
  ...(roles ? { roles } : {}),
});

export const GUIDE_SHOTS: readonly GuideShot[] = [
  shot('login'),
  shot('shell', ALL),
  shot('dashboard', ALL),
  shot('palette'),
  shot('issues-list', ALL),
  shot('issues-filter'),
  shot('issues-columns'),
  shot('issue-popup', ALL),
  shot('roadmap'),
  shot('issue-gate'),
  shot('force-done'),
  shot('new-request'),
  shot('inbox'),
  shot('contribution-new'),
  shot('contribution-comment'),
  shot('contributions-mine'),
  shot('contributions-owner'),
  shot('contribution-approve'),
  shot('projects', ['owner', 'viewer']),
  shot('project-roles', ['owner', 'viewer']),
  shot('add-project'),
  shot('agents'),
  shot('agent-detail'),
  shot('add-agent'),
  shot('skills'),
  shot('machines', ['owner', 'operator']),
  shot('machine-unpair'),
  shot('docs'),
  shot('members'),
  shot('project-access'),
  shot('settings'),
  shot('stock-ui'),
  { id: 'mac-pairing', kind: 'diagram' },
];

/**
 * Tên file ứng viên của một hình cho một vai trò, theo thứ tự ưu tiên: ảnh riêng của vai trò nếu có, không thì ảnh
 * chung, rồi ảnh của vai trò đầu (owner và admin thấy cùng một màn hình). Sơ đồ chỉ có một file `.svg`.
 */
export function shotFiles(id: string, role: GuideRole): string[] {
  const entry = GUIDE_SHOTS.find((s) => s.id === id);
  if (!entry) return [];
  if (entry.kind === 'diagram') return [`${id}.svg`];
  if (entry.roles?.includes(role)) return [`${id}.${role}.webp`];
  return [`${id}.webp`, ...(entry.roles?.length ? [`${id}.${entry.roles[0]}.webp`] : [])];
}
