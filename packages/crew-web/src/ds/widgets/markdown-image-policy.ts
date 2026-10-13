// crew: tự dựng
// Luật hiện ảnh trong markdown (mô tả, bình luận, tài liệu): ảnh nào được tải, ảnh nào chỉ thành link, ảnh nào bị chặn.

/** Ảnh nhúng base64 lớn hơn mức này không hiện trong trang (giải mã nặng, giật trang); chỉ cho tải về. */
const INLINE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Chỉ nhận ảnh raster base64 trình duyệt hiện an toàn bằng `<img>`. SVG (`image/svg+xml`) có thể mang script nên bị chặn
 * như mọi loại `data:` khác.
 */
const DATA_IMAGE = /^data:image\/(png|jpeg|jpg|gif|webp);base64,/i;

type MarkdownImageSource =
  /** Không có URL (react-markdown đã bỏ URL nguy hiểm như `javascript:`). */
  | { kind: 'none' }
  /** Ảnh cùng origin (đường dẫn tương đối hoặc tuyệt đối cùng origin): hiện bình thường. */
  | { kind: 'local'; url: string }
  /** Ảnh ở host khác: không tự tải (lộ IP, trang đang xem), chỉ hiện thành link. */
  | { kind: 'external'; url: string }
  /** Ảnh base64 nhúng thẳng trong markdown, loại được phép. `byteSize` là cỡ sau giải mã (ước theo độ dài chuỗi). */
  | { kind: 'inline'; url: string; contentType: string; byteSize: number }
  /** Ảnh base64 hợp lệ nhưng quá {@link INLINE_IMAGE_MAX_BYTES}: không hiện, chỉ cho tải. */
  | { kind: 'inline-too-large'; url: string; contentType: string; byteSize: number }
  /** `data:` loại khác (SVG, HTML…) hoặc scheme lạ: không bao giờ gán vào `src`. */
  | { kind: 'blocked' };

/** Cỡ sau giải mã của phần base64 từ vị trí `start` (bỏ ký tự đệm `=`), không chép chuỗi, không giải mã thật. */
function base64ByteSize(url: string, start: number): number {
  const length = url.length - start;
  let padding = 0;
  if (url.endsWith('==')) padding = 2;
  else if (url.endsWith('=')) padding = 1;
  return Math.max(0, Math.floor((length * 3) / 4) - padding);
}

/**
 * Phân loại `src` của một ảnh markdown. `origin` là origin của trang (mặc định trang hiện tại) để nhận ra URL tuyệt đối
 * cùng origin. Chỉ đọc tiền tố và độ dài chuỗi, nên chuỗi base64 rất lớn vẫn phân loại tức thì.
 */
function classifyImageSrc(
  src: string | null | undefined,
  origin: string = window.location.origin,
): MarkdownImageSource {
  const url = (src ?? '').trim();
  if (!url) return { kind: 'none' };
  if (/^data:/i.test(url)) {
    const m = DATA_IMAGE.exec(url);
    if (!m) return { kind: 'blocked' };
    const sub = m[1].toLowerCase();
    const contentType = `image/${sub === 'jpg' ? 'jpeg' : sub}`;
    const byteSize = base64ByteSize(url, m[0].length);
    return byteSize > INLINE_IMAGE_MAX_BYTES
      ? { kind: 'inline-too-large', url, contentType, byteSize }
      : { kind: 'inline', url, contentType, byteSize };
  }
  if (url.startsWith('//')) return { kind: 'external', url };
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { kind: 'blocked' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { kind: 'blocked' };
    return parsed.origin === origin ? { kind: 'local', url } : { kind: 'external', url };
  }
  return { kind: 'local', url };
}

/**
 * URL `data:` dài hơn mức này được tách khỏi markdown trước khi phân tích cú pháp: bộ phân tích đi từng ký tự (khoảng
 * 0,2 giây mỗi MB), nên ảnh nhúng vài MB làm treo trang. Ngắn hơn thì để nguyên (vài mili giây).
 */
const DATA_URL_EXTRACT_MIN = 64 * 1024;
const DATA_SCHEME = /data:/gi;
/** Ký tự kết thúc URL trong markdown: khoảng trắng, `)` và `>` (URL dạng `<…>`). */
const URL_END = /[\s)>]/;
const TOKEN_PREFIX = 'crew-inline-data:';
const TOKEN = /crew-inline-data:(\d+)/g;

interface ExtractedMarkdown {
  /** Markdown đã thay mỗi URL `data:` dài bằng một mã ngắn `crew-inline-data:<n>`. */
  markdown: string;
  /** URL gốc theo số thứ tự trong mã. */
  urls: string[];
}

/** Tách URL `data:` dài ra khỏi markdown (xem {@link DATA_URL_EXTRACT_MIN}); không có thì trả nguyên chuỗi. */
function extractLongDataUrls(markdown: string): ExtractedMarkdown {
  const urls: string[] = [];
  if (markdown.length < DATA_URL_EXTRACT_MIN) return { markdown, urls };
  // Quét tay thay vì regex có lượng từ lớn: irregexp tràn stack với chuỗi hàng triệu ký tự.
  let out = '';
  let copied = 0;
  DATA_SCHEME.lastIndex = 0;
  for (let m = DATA_SCHEME.exec(markdown); m; m = DATA_SCHEME.exec(markdown)) {
    let end = m.index + m[0].length;
    while (end < markdown.length && !URL_END.test(markdown[end])) end += 1;
    if (end - m.index >= DATA_URL_EXTRACT_MIN) {
      urls.push(markdown.slice(m.index, end));
      out += `${markdown.slice(copied, m.index)}${TOKEN_PREFIX}${urls.length - 1}`;
      copied = end;
    }
    DATA_SCHEME.lastIndex = end;
  }
  return urls.length ? { markdown: out + markdown.slice(copied), urls } : { markdown, urls };
}

/** Trả lại URL gốc cho mọi mã `crew-inline-data:<n>` trong chuỗi (URL ảnh, link hay chữ trong khối code). */
function restoreDataUrls(value: string, urls: readonly string[]): string {
  if (urls.length === 0 || !value.includes(TOKEN_PREFIX)) return value;
  return value.replace(TOKEN, (token, n: string) => urls[Number(n)] ?? token);
}

export type { ExtractedMarkdown, MarkdownImageSource };
export { classifyImageSrc, DATA_URL_EXTRACT_MIN, extractLongDataUrls, INLINE_IMAGE_MAX_BYTES, restoreDataUrls };
