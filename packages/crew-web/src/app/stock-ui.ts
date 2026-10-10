// Liên kết sang UI Paperclip gốc (để so sánh). Gốc lấy từ biến build CREW_STOCK_UI_URL; rỗng thì ẩn nút.
declare const __CREW_STOCK_UI_URL__: string | undefined;

/** Nhận URL tuyệt đối giao thức web hoặc đường dẫn cùng origin (`/paperclip`); bỏ dấu `/` cuối; giá trị hỏng coi như chưa cấu hình. */
export function normalizeStockUiBase(raw: string | undefined | null): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  if (value.startsWith('/')) return value.startsWith('//') || value.includes('\\') ? '' : value.replace(/\/+$/, '');
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return value.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function stockUiBase(): string {
  return normalizeStockUiBase(typeof __CREW_STOCK_UI_URL__ === 'undefined' ? '' : __CREW_STOCK_UI_URL__);
}

/** Phần trang đối tượng có cùng đường dẫn ở UI gốc: /:prefix/{issues|projects|agents}/:ref (agent thêm /runs/:runId). */
const OBJECT_SECTIONS = new Set(['issues', 'projects', 'agents']);

/** URL UI gốc tương ứng trang Crew đang xem; không map được thì trang chủ UI gốc; chưa cấu hình thì null. */
export function stockUiUrl(base: string, pathname: string): string | null {
  if (!base) return null;
  const [prefix, section, ref, sub, runId] = pathname.split('/').filter(Boolean);
  if (prefix && section && ref && OBJECT_SECTIONS.has(section) && ref !== 'new') {
    const tail = section === 'agents' && sub === 'runs' && runId ? `/runs/${runId}` : '';
    return `${base}/${prefix}/${section}/${ref}${tail}`;
  }
  return `${base}/`;
}
