// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RenameDialog } from '@/features/agents/detail/rename-dialog';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { agent, ID } from './helpers';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const mount = (onSaved?: () => void) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RenameDialog open onOpenChange={() => {}} agent={agent() as never} companyId="c-tps" onSaved={onSaved} />
    </QueryClientProvider>,
  );

describe('RenameDialog', () => {
  it('S11.7: PATCH chỉ gửi name và icon', async () => {
    const s = mockServer({ [`PATCH /api/agents/${ID.executor}`]: { body: agent({ name: 'Mới' }) } });
    const onSaved = vi.fn();
    mount(onSaved);
    fireEvent.change(screen.getByLabelText('Tên agent'), { target: { value: 'Mới' } });
    fireEvent.change(screen.getByLabelText('Biểu tượng'), { target: { value: 'bot' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const patch = s.calls.find((c) => c.method === 'PATCH');
    const body = (patch?.body ?? {}) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['icon', 'name']);
    expect(body).toEqual({ name: 'Mới', icon: 'bot' });
    expect(patch?.url).toContain('companyId=c-tps');
  });

  it('biểu tượng trống gửi null', async () => {
    const s = mockServer({ [`PATCH /api/agents/${ID.executor}`]: { body: agent() } });
    mount();
    fireEvent.change(screen.getByLabelText('Tên agent'), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(s.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'B', icon: null });
  });

  it('tên rỗng thì không gửi', () => {
    const s = mockServer({});
    mount();
    fireEvent.change(screen.getByLabelText('Tên agent'), { target: { value: ' ' } });
    expect((screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement).disabled).toBe(true);
    expect(s.calls).toEqual([]);
  });

  it('lỗi server hiện nguyên văn', async () => {
    mockServer({ [`PATCH /api/agents/${ID.executor}`]: { status: 422, body: { error: 'Tên đã có' } } });
    mount();
    fireEvent.change(screen.getByLabelText('Tên agent'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Tên đã có')).toBeTruthy();
  });
});
