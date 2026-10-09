// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RenameDialog } from '@/features/projects/detail/rename-dialog';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { project } from './helpers';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

describe('RenameDialog', () => {
  it('PATCH /projects/:id chỉ gửi name|description|color|icon', async () => {
    const s = mockServer({ 'PATCH /api/projects/p1': { body: project({ name: 'Beta' }) } });
    const onSaved = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RenameDialog open onOpenChange={() => {}} project={project() as never} companyId="c-tps" onSaved={onSaved} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Tên project'), { target: { value: 'Beta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const patch = s.calls.find((c) => c.method === 'PATCH');
    const body = (patch?.body ?? {}) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['color', 'description', 'icon', 'name']);
    expect(body.name).toBe('Beta');
    expect(patch?.url).toContain('companyId=c-tps');
  });

  it('tên rỗng thì không gửi', () => {
    const s = mockServer({});
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RenameDialog open onOpenChange={() => {}} project={project() as never} companyId="c-tps" />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Tên project'), { target: { value: '  ' } });
    expect((screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement).disabled).toBe(true);
    expect(s.calls).toEqual([]);
  });

  it('lỗi server hiện nguyên văn', async () => {
    mockServer({ 'PATCH /api/projects/p1': { status: 422, body: { error: 'Tên đã tồn tại' } } });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RenameDialog open onOpenChange={() => {}} project={project() as never} companyId="c-tps" />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Tên project'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Tên đã tồn tại')).toBeTruthy();
  });
});
