// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ModelSelect } from '@/features/agents/detail/model-select';
import { initI18n, setLanguage } from '@/i18n';
import { CREW_MODELS } from '@/lib/instructions';
import { mockServer } from '../../app/fetch-mock';
import { agent, renderWith } from './helpers';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

describe('ModelSelect', () => {
  it('chỉ liệt kê CREW_MODELS', () => {
    mockServer({});
    renderWith(<ModelSelect agent={agent() as never} companyId="c-tps" />);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Model mặc định' }), { key: 'Enter' });
    const names = screen.getAllByRole('option').map((o) => o.textContent);
    expect(names.sort()).toEqual([...CREW_MODELS].sort());
  });

  it('chưa đổi thì Lưu tắt', () => {
    mockServer({});
    renderWith(<ModelSelect agent={agent() as never} companyId="c-tps" />);
    expect((screen.getByRole('button', { name: 'Lưu model' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Lưu gửi PATCH {adapterConfig:{model}} và không gì khác', async () => {
    const s = mockServer({
      'PATCH /api/agents/e2222222-2222-4222-8222-222222222222': {
        body: agent({ adapterConfig: { model: 'claude-opus-5' } }),
      },
    });
    const onSaved = vi.fn();
    renderWith(<ModelSelect agent={agent() as never} companyId="c-tps" onSaved={onSaved} />);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Model mặc định' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'claude-opus-5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu model' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const patch = s.calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({ adapterConfig: { model: 'claude-opus-5' } });
    expect(JSON.stringify(patch?.body)).not.toContain('replaceAdapterConfig');
    expect(patch?.url).toContain('companyId=c-tps');
  });

  it('lỗi server hiện nguyên văn', async () => {
    mockServer({
      'PATCH /api/agents/e2222222-2222-4222-8222-222222222222': {
        status: 422,
        body: { error: 'Model bị từ chối' },
      },
    });
    renderWith(<ModelSelect agent={agent() as never} companyId="c-tps" />);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Model mặc định' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'claude-opus-5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu model' }));
    expect(await screen.findByText('Model bị từ chối')).toBeTruthy();
  });
});
