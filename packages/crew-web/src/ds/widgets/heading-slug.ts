// crew: tự dựng
// Id cho heading của trang tài liệu, kiểu GitHub: chữ thường, giữ chữ (cả tiếng Việt) và số, khoảng trắng thành `-`.
// Heading trùng tên nhận hậu tố `-1`, `-2`… nên link `#neo` viết trong repo vẫn trỏ đúng.

function slugBase(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'muc'
  );
}

/** Mỗi lần render một trang tạo một slugger mới để đếm trùng từ đầu. */
export function createSlugger(): (text: string) => string {
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  return (text) => {
    const base = slugBase(text);
    let slug = base;
    let count = counts.get(base) ?? 0;
    while (seen.has(slug)) {
      count += 1;
      slug = `${base}-${count}`;
    }
    counts.set(base, count);
    seen.add(slug);
    return slug;
  };
}
