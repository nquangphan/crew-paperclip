// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ModelSelect } from '@/features/agents/detail/model-select';
import { initI18n, setLanguage } from '@/i18n';
import { CREW_MODELS } from '@/lib/instructions';
import { mockServer } from '../../app/fetch-mock';
import { agent, ID, ROLES, renderWith } from './helpers';

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

  it('agent Codex: chỉ model Codex; agent OpenCode: chỉ model OpenCode', () => {
    mockServer({});
    renderWith(
      <ModelSelect
        agent={agent({ adapterType: 'codex_local', adapterConfig: { model: 'gpt-6-luna' } }) as never}
        companyId="c-tps"
      />,
    );
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Model mặc định' }), { key: 'Enter' });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['gpt-6-luna', 'gpt-6-sol']);
    cleanup();
    renderWith(
      <ModelSelect
        agent={agent({ adapterType: 'opencode_local', adapterConfig: { model: 'opencode-go/kimi-k3' } }) as never}
        companyId="c-tps"
      />,
    );
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Model mặc định' }), { key: 'Enter' });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'opencode-go/deepseek-v4-flash',
      'opencode-go/kimi-k3',
      'opencode-go/glm-5.3',
    ]);
  });

  it('model Claude trên agent Codex là ngoài bảng của runtime', () => {
    mockServer({});
    renderWith(
      <ModelSelect
        agent={agent({ adapterType: 'codex_local', adapterConfig: { model: 'claude-sonnet-5' } }) as never}
        companyId="c-tps"
      />,
    );
    expect(screen.getByText('Model hiện tại (claude-sonnet-5) không nằm trong bảng model Crew.')).toBeTruthy();
  });

  it('reviewer Codex của project: model cố định, không đổi được', async () => {
    mockServer({
      'GET /api/companies/c-tps/projects': { body: [{ id: 'p1', name: 'Demo', archivedAt: null }] },
      'GET /api/plugins/crew.core/api/projects/p1/roles': {
        body: { roles: { ...ROLES, codexReviewerAgentId: ID.spare } },
      },
    });
    renderWith(
      <ModelSelect
        agent={agent({ id: ID.spare, adapterType: 'codex_local', adapterConfig: { model: 'gpt-6-sol' } }) as never}
        companyId="c-tps"
      />,
    );
    expect(await screen.findByText('Reviewer Codex chạy model cố định gpt-6-sol, effort high.')).toBeTruthy();
    expect((screen.getByRole('combobox', { name: 'Model mặc định' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
