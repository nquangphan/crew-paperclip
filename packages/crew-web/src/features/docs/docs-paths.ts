// Hàm thuần của trang Docs: cây trang, trang mở mặc định, bỏ tiêu đề trùng ở đầu bài.
import { buildDocsTree, type DocsNode } from '@crew/paperclip-plugin/shared/docs-tree';

export { buildDocsTree };

/** Tên file được coi là trang chủ của một thư mục, theo thứ tự ưu tiên. */
const HOME_NAMES = ['index.md', 'readme.md'];

const depthOf = (path: string) => path.split('/').length;
const homeRank = (path: string) => HOME_NAMES.indexOf(path.split('/').at(-1)?.toLowerCase() ?? '');

/** Trang đầu tiên theo thứ tự cây (thư mục trước, tên theo bảng chữ cái), như người đọc thấy ở thanh bên. */
function firstPage(nodes: DocsNode[]): string | null {
  for (const node of nodes) {
    if (node.type === 'page') return node.path;
    const inner = firstPage(node.children);
    if (inner) return inner;
  }
  return null;
}

/**
 * Trang mở khi chưa chọn trang: `index.md` hoặc `README.md` nông nhất (gốc repo trước, rồi `docs/`…), `index` trước
 * `README` khi cùng cấp; không có thì trang đầu tiên của cây. Không có trang nào thì `null`.
 */
export function defaultDocPath(pages: readonly { path: string; title: string }[]): string | null {
  const homes = pages
    .filter((p) => homeRank(p.path) >= 0)
    .sort(
      (a, b) =>
        depthOf(a.path) - depthOf(b.path) || homeRank(a.path) - homeRank(b.path) || a.path.localeCompare(b.path),
    );
  return homes[0]?.path ?? firstPage(buildDocsTree([...pages]));
}

/** Bỏ heading `# …` đầu bài khi nó trùng tiêu đề trang (tiêu đề đã hiện ở đầu bài đọc). */
export function stripLeadingTitle(markdown: string, title: string): string {
  const match = /^\s*#[ \t]+([^\n]*?)[ \t#]*(?:\n|$)/.exec(markdown);
  if (!match || match[1]?.trim() !== title.trim()) return markdown;
  return markdown.slice(match[0].length);
}

/** Tên hiển thị của trang: tiêu đề, không có thì tên file. */
export const pageTitle = (page: { path: string; title: string }) =>
  page.title || page.path.split('/').at(-1) || page.path;
