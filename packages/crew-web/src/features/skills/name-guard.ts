// Chặn skill trùng tên với skill Superpowers đã ghim trên máy (Q6): agent nạp Superpowers bằng `--plugin-dir`,
// nên một skill company cùng tên sẽ che hoặc bị che. Danh sách lấy từ bản tin của mọi máy trong company.

interface SuperpowersSource {
  superpowers: { skills?: readonly string[] };
}

const norm = (name: string): string => name.trim().toLowerCase();

/** Có ít nhất một máy báo danh sách skill Superpowers (kể cả danh sách rỗng). */
export function hasSuperpowersData(reports: readonly SuperpowersSource[]): boolean {
  return reports.some((r) => Array.isArray(r.superpowers.skills));
}

/**
 * Tên skill Superpowers bị trùng với `name` (không phân biệt hoa thường), hoặc null nếu không trùng
 * HOẶC chưa có dữ liệu. Muốn phân biệt hai trường hợp thì gọi thêm `hasSuperpowersData`.
 */
export function superpowersNameClash(name: string, reports: readonly SuperpowersSource[]): string | null {
  const wanted = norm(name);
  if (!wanted) return null;
  for (const report of reports) {
    const hit = report.superpowers.skills?.find((skill) => norm(skill) === wanted);
    if (hit !== undefined) return hit;
  }
  return null;
}
