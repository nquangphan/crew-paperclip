// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AttachmentViewer, type AttachmentViewerFile } from '@/ds';
import { initI18n, setLanguage } from '@/i18n';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const make = (id: string, name: string, contentType: string): AttachmentViewerFile => ({
  id,
  name,
  contentType,
  byteSize: 1024,
  url: `/api/attachments/${id}/content`,
  downloadUrl: `/api/attachments/${id}/content?download=1`,
});
const IMG1 = make('i1', 'a.png', 'image/png');
const IMG2 = make('i2', 'b.png', 'image/png');

const nav = { index: 0, total: 2, onStep: vi.fn() };
const open = (file: AttachmentViewerFile, extra: Partial<Parameters<typeof AttachmentViewer>[0]> = {}) =>
  render(<AttachmentViewer file={file} onClose={() => {}} {...extra} />);
const zoomIn = () => screen.getByRole('button', { name: 'Phóng to' });
const zoomOut = () => screen.getByRole('button', { name: 'Thu nhỏ' });
const pct = () => screen.getByRole('button', { name: 'Vừa khung' });
const dialog = () => screen.getByTestId('attachment-viewer');
const img = () => screen.getByRole('img', { name: /\.png$/ });

describe('zoom ảnh trong hộp xem', () => {
  it('mặc định vừa khung: 100%, Thu nhỏ bị khóa, ảnh chưa dịch', () => {
    open(IMG1);
    expect(pct().textContent).toBe('100%');
    expect((zoomOut() as HTMLButtonElement).disabled).toBe(true);
    expect((zoomIn() as HTMLButtonElement).disabled).toBe(false);
    expect(img().style.transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('nút Phóng to và Thu nhỏ đổi mức, nút Vừa khung về 100%', () => {
    open(IMG1);
    fireEvent.click(zoomIn());
    expect(pct().textContent).toBe('125%');
    expect(img().style.transform).toContain('scale(1.25)');
    fireEvent.click(zoomIn());
    expect(pct().textContent).toBe('156%');
    fireEvent.click(zoomOut());
    expect(pct().textContent).toBe('125%');
    fireEvent.click(zoomIn());
    fireEvent.click(pct());
    expect(pct().textContent).toBe('100%');
  });

  it('Phóng to bị khóa ở mức tối đa 800%', () => {
    open(IMG1);
    for (let i = 0; i < 12; i++) if (!(zoomIn() as HTMLButtonElement).disabled) fireEvent.click(zoomIn());
    expect(pct().textContent).toBe('800%');
    expect((zoomIn() as HTMLButtonElement).disabled).toBe(true);
    expect((zoomOut() as HTMLButtonElement).disabled).toBe(false);
  });

  it('phím + = - 0 khi hộp có focus', () => {
    open(IMG1);
    fireEvent.keyDown(dialog(), { key: '+' });
    expect(pct().textContent).toBe('125%');
    fireEvent.keyDown(dialog(), { key: '=' });
    expect(pct().textContent).toBe('156%');
    fireEvent.keyDown(dialog(), { key: '-' });
    expect(pct().textContent).toBe('125%');
    fireEvent.keyDown(dialog(), { key: '0' });
    expect(pct().textContent).toBe('100%');
  });

  it('phím mũi tên vẫn chuyển ảnh', () => {
    const onStep = vi.fn();
    open(IMG1, { nav: { ...nav, onStep } });
    fireEvent.keyDown(dialog(), { key: 'ArrowRight' });
    expect(onStep).toHaveBeenCalledWith(1);
  });

  it('cuộn chuột phóng ảnh và chặn trang cuộn; cuộn xuống thu lại', () => {
    open(IMG1);
    const stage = screen.getByTestId('attachment-viewer-stage');
    const notPrevented = fireEvent.wheel(stage, { deltaY: -200, clientX: 10, clientY: 10 });
    expect(notPrevented).toBe(false);
    expect(Number.parseInt(pct().textContent ?? '', 10)).toBeGreaterThan(100);
    fireEvent.wheel(stage, { deltaY: 2000 });
    expect(pct().textContent).toBe('100%');
  });

  it('chụm trackpad (wheel kèm ctrlKey) cũng phóng', () => {
    open(IMG1);
    fireEvent.wheel(screen.getByTestId('attachment-viewer-stage'), { deltaY: -10, ctrlKey: true });
    expect(Number.parseInt(pct().textContent ?? '', 10)).toBeGreaterThan(100);
  });

  it('bấm đúp: vừa khung thì phóng 250%, đang zoom thì về vừa khung', () => {
    open(IMG1);
    const stage = screen.getByTestId('attachment-viewer-stage');
    fireEvent.doubleClick(stage, { clientX: 5, clientY: 5 });
    expect(pct().textContent).toBe('250%');
    fireEvent.doubleClick(stage);
    expect(pct().textContent).toBe('100%');
  });

  it('chuyển sang ảnh khác thì về vừa khung', () => {
    const { rerender } = open(IMG1, { nav });
    fireEvent.click(zoomIn());
    expect(pct().textContent).toBe('125%');
    rerender(<AttachmentViewer file={IMG2} onClose={() => {}} nav={{ ...nav, index: 1 }} />);
    expect(pct().textContent).toBe('100%');
  });

  it('đóng rồi mở lại cùng ảnh thì về vừa khung', () => {
    const { rerender } = open(IMG1);
    fireEvent.click(zoomIn());
    rerender(<AttachmentViewer file={null} onClose={() => {}} />);
    rerender(<AttachmentViewer file={IMG1} onClose={() => {}} />);
    expect(pct().textContent).toBe('100%');
  });

  it('ảnh lỗi tải thì không có điều khiển zoom', () => {
    open(IMG1);
    fireEvent.error(img());
    expect(screen.queryByRole('button', { name: 'Phóng to' })).toBeNull();
  });

  it.each([
    ['PDF', make('p', 'a.pdf', 'application/pdf')],
    ['video', make('v', 'a.mp4', 'video/mp4')],
    ['markdown', make('m', 'a.md', 'text/markdown')],
    ['file khác', make('z', 'a.zip', 'application/zip')],
  ])('%s không hiện điều khiển zoom và phím + không làm gì', (_label, file) => {
    open(file, { text: { status: 'success', data: '# x' } });
    expect(screen.queryByRole('button', { name: 'Phóng to' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Vừa khung' })).toBeNull();
    expect(screen.queryByTestId('attachment-viewer-stage')).toBeNull();
  });
});
