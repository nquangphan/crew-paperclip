// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MarkdownView } from '@/ds';
import { AttachmentViewerProvider, imageAttachments } from '@/features/issues/detail/attachment-viewer-provider';
import { Attachments } from '@/features/issues/detail/attachments';
import { initI18n, setLanguage } from '@/i18n';
import { mount } from './detail-fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const file = (id: string, originalFilename: string, contentType: string, byteSize = 2048) => ({
  id,
  originalFilename,
  contentType,
  byteSize,
  createdByUserId: 'u2',
  createdByAgentId: null,
});

// Nguồn: GET /api/issues/:id/attachments (IssueAttachment), thứ tự server trả.
const FILES = [
  file('img1', 'anh-1.png', 'image/png'),
  file('md1', 'ghi-chu.md', 'text/markdown'),
  file('img2', 'anh-2.jpg', 'image/jpeg'),
  file('html1', 'mockup.html', 'text/html'),
  file('zip1', 'bundle.zip', 'application/zip', 3 * 1024 * 1024),
  file('log1', 'run.log', 'text/plain'),
];

const TEXT: Record<string, string> = {
  md1: '# Tiêu đề ghi chú\n\nNội dung **đậm**',
  html1: '<!doctype html><h1>Mockup</h1>',
  log1: 'dòng 1\ndòng 2',
};

/** Server giả: danh sách JSON và nội dung file thô (không bọc JSON) như route content thật. */
function serve() {
  const fetchMock = vi.fn(async (input: string) => {
    const url = String(input);
    if (url === '/api/issues/i1/attachments') return new Response(JSON.stringify(FILES), { status: 200 });
    const m = /^\/api\/attachments\/([^/]+)\/content$/.exec(url);
    if (m && TEXT[m[1]] !== undefined) return new Response(TEXT[m[1]], { status: 200 });
    if (m && m[1] === 'broken') return new Response(JSON.stringify({ error: 'Attachment not found' }), { status: 404 });
    return new Response(JSON.stringify({ error: `no mock ${url}` }), { status: 404 });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function mountViewer(markdown = '') {
  return mount(
    <AttachmentViewerProvider issueId="i1">
      <Attachments issueId="i1" />
      {markdown ? <MarkdownView markdown={markdown} /> : null}
    </AttachmentViewerProvider>,
  );
}

const viewer = () => screen.getByTestId('attachment-viewer');

describe('hộp xem file đính kèm', () => {
  it('dãy ảnh chỉ gồm ảnh, đúng thứ tự danh sách', () => {
    expect(imageAttachments(FILES as never).map((a) => a.id)).toEqual(['img1', 'img2']);
  });

  it('bấm ảnh mở hộp xem tại chỗ (không tab mới), có tên, Tải về, Mở tab mới và bộ đếm', async () => {
    serve();
    mountViewer();
    const tile = await screen.findByRole('img', { name: 'anh-1.png' });
    expect(tile.closest('a')?.getAttribute('target')).toBeNull();
    fireEvent.click(tile);
    const box = viewer();
    expect(box.dataset.kind).toBe('image');
    expect(within(box).getByRole('heading', { name: 'anh-1.png' })).toBeTruthy();
    expect(within(box).getByRole('img', { name: 'anh-1.png' }).getAttribute('src')).toBe(
      '/api/attachments/img1/content',
    );
    expect(within(box).getByRole('link', { name: 'Tải về' }).getAttribute('href')).toBe(
      '/api/attachments/img1/content?download=true',
    );
    const newTab = within(box).getByRole('link', { name: 'Mở tab mới' });
    expect(newTab.getAttribute('href')).toBe('/api/attachments/img1/content');
    expect(newTab.getAttribute('target')).toBe('_blank');
    expect(within(box).getByTestId('attachment-viewer-counter').textContent).toBe('1 / 2');
  });

  it('trước/sau bằng nút và phím mũi tên, dừng ở hai đầu', async () => {
    serve();
    mountViewer();
    fireEvent.click(await screen.findByRole('img', { name: 'anh-1.png' }));
    const prev = within(viewer()).getByRole('button', { name: 'Ảnh trước' }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    fireEvent.click(within(viewer()).getByRole('button', { name: 'Ảnh sau' }));
    expect(within(viewer()).getByTestId('attachment-viewer-counter').textContent).toBe('2 / 2');
    expect(within(viewer()).getByRole('heading', { name: 'anh-2.jpg' })).toBeTruthy();
    expect((within(viewer()).getByRole('button', { name: 'Ảnh sau' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(viewer(), { key: 'ArrowRight' });
    expect(within(viewer()).getByTestId('attachment-viewer-counter').textContent).toBe('2 / 2');
    fireEvent.keyDown(viewer(), { key: 'ArrowLeft' });
    expect(within(viewer()).getByTestId('attachment-viewer-counter').textContent).toBe('1 / 2');
  });

  it('nút X và Esc đóng hộp xem', async () => {
    serve();
    mountViewer();
    fireEvent.click(await screen.findByRole('img', { name: 'anh-1.png' }));
    fireEvent.click(within(viewer()).getByRole('button', { name: 'Đóng' }));
    expect(screen.queryByTestId('attachment-viewer')).toBeNull();
    fireEvent.click(screen.getByRole('img', { name: 'anh-1.png' }));
    fireEvent.keyDown(viewer(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('attachment-viewer')).toBeNull());
  });

  it('markdown tải nội dung (cookie cùng origin) và render bằng trình render markdown', async () => {
    const fetchMock = serve();
    mountViewer();
    fireEvent.click(await screen.findByRole('link', { name: /ghi-chu\.md/ }));
    expect(viewer().dataset.kind).toBe('markdown');
    expect(await within(viewer()).findByRole('heading', { name: 'Tiêu đề ghi chú' })).toBeTruthy();
    expect(within(viewer()).queryByTestId('attachment-viewer-counter')).toBeNull();
    const call = fetchMock.mock.calls.find(([u]) => u === '/api/attachments/md1/content') as unknown as [
      string,
      RequestInit,
    ];
    expect(call[1].credentials).toBe('include');
  });

  it('file chữ hiện nguyên văn trong <pre>', async () => {
    serve();
    mountViewer();
    fireEvent.click(await screen.findByRole('link', { name: /run\.log/ }));
    await waitFor(() => expect(viewer().querySelector('pre')?.textContent).toBe('dòng 1\ndòng 2'));
  });

  it('HTML hiện trong iframe sandbox không có allow-same-origin', async () => {
    serve();
    mountViewer();
    fireEvent.click(await screen.findByRole('link', { name: /mockup\.html/ }));
    const frame = await waitFor(() => {
      const f = viewer().querySelector('iframe');
      expect(f).not.toBeNull();
      return f as HTMLIFrameElement;
    });
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('srcdoc')).toBe(TEXT.html1);
    expect(frame.getAttribute('src')).toBeNull();
  });

  it('file khác (zip) hiện tên, cỡ, loại và nút Tải về; không tải nội dung', async () => {
    const fetchMock = serve();
    mountViewer();
    fireEvent.click(await screen.findByRole('link', { name: /bundle\.zip/ }));
    const box = viewer();
    expect(box.dataset.kind).toBe('other');
    expect(within(box).getByText('3 MB')).toBeTruthy();
    expect(within(box).getByText('application/zip')).toBeTruthy();
    const downloads = within(box).getAllByRole('link', { name: 'Tải về' });
    expect(downloads.every((a) => a.getAttribute('href') === '/api/attachments/zip1/content?download=true')).toBe(true);
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/attachments/zip1/content')).toBe(false);
  });

  it('Cmd/Ctrl+click giữ hành vi link (không mở hộp xem)', async () => {
    serve();
    mountViewer();
    fireEvent.click(await screen.findByRole('link', { name: /ghi-chu\.md/ }), { metaKey: true });
    expect(screen.queryByTestId('attachment-viewer')).toBeNull();
  });

  it('link và ảnh file đính kèm trong markdown mở hộp xem; link ngoài vẫn mở tab mới', async () => {
    serve();
    mountViewer(
      '[ghi chú](/api/attachments/md1/content) · [web](https://example.com) · ![anh](/api/attachments/img2/content)',
    );
    const md = await screen.findByText('ghi chú');
    const external = screen.getByRole('link', { name: 'web' });
    expect(external.getAttribute('target')).toBe('_blank');
    fireEvent.click(md);
    expect(await within(viewer()).findByRole('heading', { name: 'Tiêu đề ghi chú' })).toBeTruthy();
    fireEvent.click(within(viewer()).getByRole('button', { name: 'Đóng' }));

    fireEvent.click(screen.getByRole('button', { name: 'anh' }));
    expect(within(viewer()).getByRole('heading', { name: 'anh-2.jpg' })).toBeTruthy();
    expect(within(viewer()).getByTestId('attachment-viewer-counter').textContent).toBe('2 / 2');
  });

  it('link file không có trong danh sách: lấy chữ của link làm tên, loại theo đuôi; lỗi tải hiện thông báo', async () => {
    serve();
    mountViewer('[bao-cao.md](/api/attachments/broken/content)');
    fireEvent.click(await screen.findByText('bao-cao.md'));
    expect(within(viewer()).getByRole('heading', { name: 'bao-cao.md' })).toBeTruthy();
    expect(await within(viewer()).findByText('Không tải được nội dung file')).toBeTruthy();
    expect(within(viewer()).getByText('Attachment not found')).toBeTruthy();
  });

  it('ảnh base64 trong markdown bấm mở hộp xem: hiện ảnh, Tải về từ chính ảnh, không có Mở tab mới, không bộ đếm', async () => {
    const fetchMock = serve();
    const src = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    mountViewer(`![mockup trang chủ](${src})`);
    fireEvent.click(await screen.findByRole('button', { name: 'mockup trang chủ' }));
    const box = viewer();
    expect(box.dataset.kind).toBe('image');
    expect(within(box).getByRole('heading', { name: 'mockup trang chủ' })).toBeTruthy();
    expect(within(box).getByRole('img', { name: 'mockup trang chủ' }).getAttribute('src')).toBe(src);
    expect(within(box).getByRole('link', { name: 'Tải về' }).getAttribute('href')).toBe(src);
    expect(within(box).queryByRole('link', { name: 'Mở tab mới' })).toBeNull();
    expect(within(box).queryByTestId('attachment-viewer-counter')).toBeNull();
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('data:'))).toBe(false);
  });

  it('ảnh SVG base64 trong markdown bị chặn, không bấm được', async () => {
    serve();
    mountViewer('![sơ đồ](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)');
    expect(await screen.findByText('sơ đồ')).toBeTruthy();
    expect(screen.getByText('(ảnh bị chặn)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'sơ đồ' })).toBeNull();
    expect(document.querySelector('img[src^="data:"]')).toBeNull();
  });
});
