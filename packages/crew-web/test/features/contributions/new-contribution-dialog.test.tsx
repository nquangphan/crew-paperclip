// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NewRequestDialog } from '@/features/issues/new/new-request-dialog';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer } from '../../app/fetch-mock';
import { wrap } from '../issues/detail-fixtures';
import { contribution, GUEST_ACCESS } from './fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

const PROJECTS = [
  { id: 'p1', name: 'Alpha', archivedAt: null },
  { id: 'p2', name: 'Cũ', archivedAt: '2026-01-01T00:00:00.000Z' },
];

describe('dialog gửi yêu cầu của khách góp ý', () => {
  it('gửi đúng body, chỉ gồm project, tiêu đề, mô tả, rồi báo đã gửi', async () => {
    const { calls } = mockServer({
      ...accessRoute('c1', GUEST_ACCESS),
      'GET /api/companies/c1/projects': { body: PROJECTS },
      'POST /api/crew/companies/c1/contributions': {
        status: 201,
        body: contribution({ kind: 'issue', projectId: 'p1', title: 'Cần banner', targetIssueId: null }),
      },
    });
    render(wrap(<NewRequestDialog open onOpenChange={() => {}} companyId="c1" />));

    expect(await screen.findByText('Gửi yêu cầu (chờ duyệt)')).toBeTruthy();
    // Không có loại, người nhận, nháp.
    expect(screen.queryByText('Lưu nháp (chưa chạy)')).toBeNull();
    const submit = screen.getByRole('button', { name: 'Gửi để owner duyệt' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(await screen.findByRole('combobox', { name: 'Project' }));
    expect(screen.queryByRole('option', { name: 'Cũ' })).toBeNull();
    fireEvent.click(await screen.findByRole('option', { name: 'Alpha' }));
    fireEvent.change(screen.getByLabelText('Tiêu đề'), { target: { value: '  Cần banner  ' } });
    fireEvent.change(screen.getByLabelText('Mô tả'), { target: { value: 'Banner tháng 10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi để owner duyệt' }));

    expect(await screen.findByText('Đã gửi, chờ owner duyệt')).toBeTruthy();
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('/api/crew/companies/c1/contributions');
    expect(post?.body).toEqual({ kind: 'issue', projectId: 'p1', title: 'Cần banner', description: 'Banner tháng 10' });
  });

  it('báo lỗi nguyên văn và giữ form khi server từ chối', async () => {
    mockServer({
      ...accessRoute('c1', GUEST_ACCESS),
      'GET /api/companies/c1/projects': { body: PROJECTS },
      'POST /api/crew/companies/c1/contributions': { status: 400, body: { error: 'Tiêu đề không hợp lệ' } },
    });
    render(wrap(<NewRequestDialog open onOpenChange={() => {}} companyId="c1" />));
    fireEvent.click(await screen.findByRole('combobox', { name: 'Project' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Alpha' }));
    fireEvent.change(screen.getByLabelText('Tiêu đề'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi để owner duyệt' }));
    expect(await screen.findByText('Tiêu đề không hợp lệ')).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('Tiêu đề')).toBeTruthy());
  });

  it('owner vẫn thấy dialog Yêu cầu mới thường', async () => {
    mockServer({
      'GET /api/companies/c1/projects': { body: PROJECTS },
      'GET /api/companies/c1/agents': { body: [] },
    });
    render(wrap(<NewRequestDialog open onOpenChange={() => {}} companyId="c1" />));
    expect(await screen.findByText('Trợ Lý của project nhận yêu cầu, tách việc và giao cho các agent.')).toBeTruthy();
    expect(screen.queryByText('Gửi yêu cầu (chờ duyệt)')).toBeNull();
  });
});
