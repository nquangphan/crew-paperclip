// Người đọc của trang Hướng dẫn: mỗi vai trò chỉ thấy phần của mình. Admin và Operator dùng chung một bản (việc hằng
// ngày, không có phần chỉ owner làm). Phòng Marketing và Phòng QC (cùng quyền, chung một bản) là viewer có dấu khách góp
// ý. File không import gì để script chụp ảnh (e2e) dùng chung được.

export const GUIDE_ROLES = ['owner', 'operator', 'viewer', 'contributor'] as const;
export type GuideRole = (typeof GUIDE_ROLES)[number];

export const isGuideRole = (value: unknown): value is GuideRole =>
  typeof value === 'string' && (GUIDE_ROLES as readonly string[]).includes(value);

/**
 * Bản hướng dẫn theo vai trò đang đăng nhập; null khi vai trò còn đang tải. Lỗi tải vai trò thì UI không khóa nút ghi
 * (server vẫn là cổng thật), nên hướng dẫn cũng là bản việc hằng ngày. Admin instance không có membership cũng vậy.
 */
export function guideRoleFor(access: {
  isOwner: boolean;
  isContributor: boolean;
  membershipRole: string | null;
  loading: boolean;
  error: Error | null;
}): GuideRole | null {
  if (access.loading && !access.error) return null;
  if (access.isOwner) return 'owner';
  if (access.isContributor) return 'contributor';
  if (access.membershipRole === 'viewer') return 'viewer';
  return 'operator';
}

/** Owner xem thử bản của vai trò khác qua `?role=`; người khác luôn thấy bản của mình. */
export function previewRole(own: GuideRole, requested: string | null): GuideRole {
  return own === 'owner' && isGuideRole(requested) ? requested : own;
}
