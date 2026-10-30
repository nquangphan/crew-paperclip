// Dán vào terminal: nhiều dòng thì bọc bracketed paste để CLI (Claude Code…) nhận cả khối thay vì chạy từng dòng;
// dán lớn thì chia khúc để không dồn một khung WebSocket quá to.

const KiB = 1024;
export const PASTE_CHUNK_SIZE = 16 * KiB;
export const PASTE_MAX_SIZE = 16 * KiB * KiB;

export class PasteTooLargeError extends Error {
  constructor() {
    super('Nội dung dán quá lớn');
    this.name = 'PasteTooLargeError';
  }
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** Các khúc cần gửi theo thứ tự. Kích thước đo bằng đơn vị UTF-16; không cắt giữa một cặp surrogate. */
export function preparePaste(text: string): string[] {
  if (text.length > PASTE_MAX_SIZE) throw new PasteTooLargeError();
  // Như xterm khi tự dán: xuống dòng thành CR, là phím Enter với chương trình trong terminal.
  const body = text.includes('\n') ? `\x1b[200~${text.replace(/\r?\n/g, '\r')}\x1b[201~` : text;
  const chunks: string[] = [];
  let start = 0;
  while (start < body.length) {
    let end = Math.min(body.length, start + PASTE_CHUNK_SIZE);
    if (end < body.length && isHighSurrogate(body.charCodeAt(end - 1))) end -= 1;
    chunks.push(body.slice(start, end));
    start = end;
  }
  return chunks;
}
