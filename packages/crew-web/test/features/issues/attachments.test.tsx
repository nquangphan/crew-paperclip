// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Attachments } from '@/features/issues/detail/attachments';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { mount } from './detail-fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

// Nguồn: GET /api/issues/:id/attachments (IssueAttachment).
const FILES = [
  { id: 'at1', originalFilename: 'cua-toi.png', byteSize: 2048, createdByUserId: 'u1', createdByAgentId: null },
  { id: 'at2', originalFilename: 'cua-agent.md', byteSize: 10, createdByUserId: null, createdByAgentId: 'a1' },
  { id: 'at3', originalFilename: 'cua-nguoi-khac.txt', byteSize: 10, createdByUserId: 'u2', createdByAgentId: null },
];

describe('Attachments (S6.6)', () => {
  it('chỉ có nút xóa ở file do người dùng hiện tại tạo', async () => {
    mockServer({ 'GET /api/issues/i1/attachments': { body: FILES } });
    mount(<Attachments issueId="i1" />);
    await screen.findByText(/cua-toi\.png/);
    expect(screen.getAllByRole('button', { name: /^Xóa / })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Xóa cua-toi.png' })).toBeTruthy();
  });

  it('link tải trỏ tới nội dung file', async () => {
    mockServer({ 'GET /api/issues/i1/attachments': { body: FILES } });
    mount(<Attachments issueId="i1" />);
    const link = await screen.findByRole('link', { name: /cua-agent\.md/ });
    expect(link.getAttribute('href')).toBe('/api/attachments/at2/content');
  });

  it('xóa phải qua hộp xác nhận, hủy thì không gọi API', async () => {
    const s = mockServer({ 'GET /api/issues/i1/attachments': { body: FILES } });
    mount(<Attachments issueId="i1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa cua-toi.png' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    expect(s.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('xác nhận thì DELETE /attachments/:id', async () => {
    const s = mockServer({
      'GET /api/issues/i1/attachments': { body: FILES },
      'DELETE /api/attachments/at1': { body: { ok: true } },
    });
    mount(<Attachments issueId="i1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa cua-toi.png' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xóa' }));
    await waitFor(() => expect(s.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1));
  });

  it('không có file thì ghi chưa có đính kèm', async () => {
    mockServer({ 'GET /api/issues/i1/attachments': { body: [] } });
    mount(<Attachments issueId="i1" />);
    expect(await screen.findByText('Chưa có đính kèm')).toBeTruthy();
  });
});
