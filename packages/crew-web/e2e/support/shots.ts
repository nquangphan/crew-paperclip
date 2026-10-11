// Chụp ảnh cho trang Hướng dẫn: theme sáng, khung nhìn cố định, đánh dấu (khung đỏ có số) vẽ đè bằng DOM tạm, lưu
// WebP thẳng vào src/features/guide/img/<lang>/. Mã hóa WebP bằng canvas của chính Chromium, không cần gói ngoài.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Locator, Page } from '@playwright/test';

export type ShotLang = 'vi' | 'en';

export const GUIDE_IMG_DIR = path.resolve(import.meta.dirname, '..', '..', 'src', 'features', 'guide', 'img');
/** Khung nhìn chung của mọi ảnh. */
export const SHOT_VIEWPORT = { width: 1280, height: 800 } as const;
const WEBP_QUALITY = 0.82;
const OVERLAY = 'data-guide-shot-mark';

export interface Mark {
  target: Locator;
  /** Số hay chữ ngắn trên huy hiệu, khớp với "(1)", "(2)" trong bài hướng dẫn. */
  label: string;
}

/** Mọi trang của context mở ở theme sáng và đúng ngôn ngữ (đặt trước khi app đọc localStorage). */
export async function prepareContext(context: BrowserContext, lang: ShotLang): Promise<void> {
  await context.addInitScript((l) => {
    localStorage.setItem('crew.theme', 'light');
    localStorage.setItem('crew.lang', l);
  }, lang);
}

/** Vẽ khung và huy hiệu số lên các phần tử (tọa độ theo khung nhìn). Phần tử không thấy thì bỏ qua. */
export async function annotate(page: Page, marks: Mark[]): Promise<void> {
  const boxes: { x: number; y: number; width: number; height: number; label: string }[] = [];
  for (const m of marks) {
    // Phần tử không có ở vai trò hay ngôn ngữ này (ví dụ nút chỉ owner thấy) thì bỏ qua sau 1,5 giây.
    const box = await m.target
      .first()
      .boundingBox({ timeout: 1_500 })
      .catch(() => null);
    if (box && box.width > 0 && box.height > 0) boxes.push({ ...box, label: m.label });
  }
  await page.evaluate(
    ({ boxes: list, attr }) => {
      for (const b of list) {
        const pad = 4;
        const frame = document.createElement('div');
        frame.setAttribute(attr, '');
        Object.assign(frame.style, {
          position: 'fixed',
          left: `${b.x - pad}px`,
          top: `${b.y - pad}px`,
          width: `${b.width + pad * 2}px`,
          height: `${b.height + pad * 2}px`,
          border: '3px solid #e11d48',
          borderRadius: '8px',
          boxShadow: '0 0 0 4px rgba(225, 29, 72, 0.18)',
          zIndex: '2147483646',
          pointerEvents: 'none',
        });
        const badge = document.createElement('div');
        badge.setAttribute(attr, '');
        badge.textContent = b.label;
        const left = Math.max(2, b.x - pad - 12);
        const top = Math.max(2, b.y - pad - 12);
        Object.assign(badge.style, {
          position: 'fixed',
          left: `${left}px`,
          top: `${top}px`,
          minWidth: '24px',
          height: '24px',
          padding: '0 6px',
          borderRadius: '12px',
          background: '#e11d48',
          color: '#fff',
          font: '600 13px/24px system-ui, sans-serif',
          textAlign: 'center',
          zIndex: '2147483647',
          pointerEvents: 'none',
        });
        document.body.append(frame, badge);
      }
    },
    { boxes, attr: OVERLAY },
  );
}

export async function clearMarks(page: Page): Promise<void> {
  await page.evaluate((attr) => {
    for (const el of document.querySelectorAll(`[${attr}]`)) el.remove();
  }, OVERLAY);
}

/** PNG → WebP bằng canvas trong một trang trống của cùng context. */
async function toWebp(context: BrowserContext, png: Buffer): Promise<Buffer> {
  const encoder = await context.newPage();
  try {
    const b64 = await encoder.evaluate(
      async ({ data, quality }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d')?.drawImage(img, 0, 0);
        const url = canvas.toDataURL('image/webp', quality);
        if (!url.startsWith('data:image/webp')) throw new Error('Trình duyệt không mã hóa được WebP');
        return url.slice(url.indexOf(',') + 1);
      },
      { data: png.toString('base64'), quality: WEBP_QUALITY },
    );
    return Buffer.from(b64, 'base64');
  } finally {
    await encoder.close();
  }
}

/**
 * Chụp và lưu `img/<lang>/<name>.webp`. `clip`: chỉ lấy vùng của phần tử (ví dụ `main` để bỏ thanh bên), không thì cả
 * khung nhìn. Trả đường dẫn file.
 */
export async function saveShot(page: Page, lang: ShotLang, name: string, clip?: Locator): Promise<string> {
  if (!/^[a-z0-9-]+(\.[a-z]+)?$/.test(name)) throw new Error(`Tên ảnh không hợp lệ: ${name}`);
  const dir = path.join(GUIDE_IMG_DIR, lang);
  mkdirSync(dir, { recursive: true });
  const box = clip ? await clip.boundingBox() : null;
  const png = await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    ...(box
      ? { clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, SHOT_VIEWPORT.height) } }
      : {}),
  });
  const file = path.join(dir, `${name}.webp`);
  writeFileSync(file, await toWebp(page.context(), png));
  return file;
}
