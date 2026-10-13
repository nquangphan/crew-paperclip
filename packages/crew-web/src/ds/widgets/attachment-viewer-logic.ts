// crew: tự dựng
// Chọn cách xem một file đính kèm (theo content-type, thiếu thì theo đuôi tên file) và bước trước/sau giữa các ảnh.

type ViewerKind = 'image' | 'pdf' | 'markdown' | 'text' | 'html' | 'video' | 'other';

/** File chữ lớn hơn mức này không tải vào trang (nặng, trình duyệt chậm); chỉ cho tải về. */
const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

/** Content-type chung chung (server không biết loại): phải đoán theo đuôi tên file. */
const GENERIC_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/x-binary']);

/** Ảnh trình duyệt không hiện được (HEIC/HEIF) thì coi như file thường. */
const UNRENDERABLE_IMAGES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);

/** Video trình duyệt phát được bằng thẻ `<video>`. */
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v']);

const TEXT_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-javascript',
  'application/typescript',
  'application/x-yaml',
  'application/yaml',
  'application/toml',
  'application/x-sh',
  'application/sql',
]);

const EXTENSION_KINDS: Record<string, ViewerKind> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  avif: 'image',
  bmp: 'image',
  pdf: 'pdf',
  md: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  m4v: 'video',
};

/** Đuôi file chữ/code xem được bằng khối `<pre>`. */
const TEXT_EXTENSIONS = new Set(
  (
    'txt log csv tsv json jsonl yaml yml toml ini cfg conf env xml ts tsx js jsx mjs cjs py rb go rs java kt swift ' +
    'c h cpp hpp cs php sh bash zsh sql css scss less vue svelte diff patch gitignore dockerfile'
  ).split(' '),
);

const extensionOf = (name: string): string => {
  const base = name.trim().toLowerCase().split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1) : base;
};

/** Phần MIME chính (bỏ `; charset=…`), chữ thường. */
const essenceOf = (contentType: string | null | undefined): string =>
  (contentType ?? '').split(';', 1)[0].trim().toLowerCase();

function kindFromType(type: string): ViewerKind | null {
  if (GENERIC_TYPES.has(type)) return null;
  if (type.startsWith('image/')) return UNRENDERABLE_IMAGES.has(type) ? 'other' : 'image';
  if (type === 'application/pdf') return 'pdf';
  if (type === 'text/markdown' || type === 'text/x-markdown') return 'markdown';
  if (type === 'text/html' || type === 'application/xhtml+xml') return 'html';
  if (VIDEO_TYPES.has(type)) return 'video';
  if (type.startsWith('text/') || TEXT_TYPES.has(type) || type.endsWith('+json') || type.endsWith('+xml')) {
    return 'text';
  }
  return 'other';
}

function kindFromName(name: string): ViewerKind {
  const ext = extensionOf(name);
  return EXTENSION_KINDS[ext] ?? (TEXT_EXTENSIONS.has(ext) ? 'text' : 'other');
}

/** Loại cần tải nội dung chữ về trước khi hiện. */
const isTextual = (kind: ViewerKind): boolean => kind === 'markdown' || kind === 'text' || kind === 'html';

interface ViewerKindInput {
  contentType?: string | null;
  name: string;
  /** Không biết kích thước (link trong markdown trỏ file ngoài danh sách) thì không chặn theo cỡ. */
  byteSize?: number | null;
}

/**
 * Cách xem file: theo content-type; content-type thiếu hoặc chung chung thì theo đuôi tên file. Markdown lưu với
 * `text/plain` nhưng tên `.md` vẫn render markdown. File chữ quá lớn thì chỉ cho tải về.
 */
function viewerKindFor({ contentType, name, byteSize }: ViewerKindInput): ViewerKind {
  const type = essenceOf(contentType);
  const byName = kindFromName(name);
  let kind = kindFromType(type) ?? byName;
  if (kind === 'text' && (byName === 'markdown' || byName === 'html')) kind = byName;
  if (isTextual(kind) && byteSize != null && byteSize > TEXT_PREVIEW_MAX_BYTES) return 'other';
  return kind;
}

/** Vị trí sau khi bấm trước (`-1`) / sau (`+1`): dừng ở hai đầu, không vòng lại. */
function stepIndex(index: number, total: number, delta: -1 | 1): number {
  if (total <= 0) return 0;
  return Math.min(total - 1, Math.max(0, index + delta));
}

/** Cỡ file dễ đọc: `512 B`, `2 KB`, `1,5 MB` (vi) / `1.5 MB` (en). */
function formatBytes(bytes: number, lang: 'vi' | 'en'): string {
  const fmt = new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'vi-VN', { maximumFractionDigits: 1 });
  if (bytes < 1024) return `${fmt.format(bytes)} B`;
  if (bytes < 1024 * 1024) return `${fmt.format(bytes / 1024)} KB`;
  return `${fmt.format(bytes / (1024 * 1024))} MB`;
}

export type { ViewerKind, ViewerKindInput };
export { formatBytes, isTextual, stepIndex, TEXT_PREVIEW_MAX_BYTES, viewerKindFor };
