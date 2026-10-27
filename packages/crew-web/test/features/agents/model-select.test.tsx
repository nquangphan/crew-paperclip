// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ModelSelect } from '@/features/agents/detail/model-select';
import { initI18n, setLanguage } from '@/i18n';
import { crewModelsOf } from '@/lib/instructions';
import { mockServer } from '../../app/fetch-mock';
import { SETTINGS } from '../../lib/instructions/__fixtures__/model-settings';
import { agent, ID, ROLES, renderWith } from './helpers';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

/** Ô chọn model, sau khi bảng cài đặt model đã tải xong (trước đó ô tắt). */
async function openable() {
  const box = (await screen.findByRole('combobox', { name: 'Model mặc định' })) as HTMLButtonElement;
  await waitFor(() => expect(box.disabled).toBe(false));
  return box;
}

describe('ModelSelect', () => {
  it('chỉ liệt kê catalog Claude của bảng cài đặt model', async () => {
    mockServer({});
    renderWith(<ModelSelect agent={agent() as never} companyId="c-tps" />);
    fireEvent.keyDown(await openable(), { key: 'Enter' });
    const names = screen.getAllByRole('option').map((o) => o.textContent);
    expect(names).toEqual(crewModelsOf('claude_local', SETTINGS));
  });

  it('chưa đổi thì Lưu tắt', async () => {
    mockServer({});
    renderWith(<ModelSelect agent={agent() as never} companyId="c-tps" />);
    await screen.findByRole('combobox', { name: 'Model mặc định' });
    expect((screen.getByRole('button', { name: 'Lưu model' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Lưu gửi PATCH {adapterConfig:{model}} và không gì khác', async () => {
    const s = mockServer({
      'PATCH /api/agents/e2222222-2222-4222-8222-222222222222': {
        body: agent({ adapterConfig: { model: 'claude-opus-5-5' } }),
      },
    });
    const onSaved = vi.fn();
    renderWith(<ModelSelect agent={agent() as never} companyId="c-tps" onSaved={onSaved} />);
    fireEvent.keyDown(await openable(), { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'claude-opus-5-5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu model' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const patch = s.calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({ adapterConfig: { model: 'claude-opus-5-5' } });
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
    fireEvent.keyDown(await openable(), { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'claude-opus-5-5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu model' }));
    expect(await screen.findByText('Model bị từ chối')).toBeTruthy();
  });

  it('agent Codex: chỉ model Codex; agent OpenCode: chỉ model OpenCode', async () => {
    mockServer({});
    renderWith(
      <ModelSelect
        agent={agent({ adapterType: 'codex_local', adapterConfig: { model: 'gpt-6-luna' } }) as never}
        companyId="c-tps"
      />,
    );
    fireEvent.keyDown(await openable(), { key: 'Enter' });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['gpt-6-luna', 'gpt-6-sol']);
    cleanup();
    renderWith(
      <ModelSelect
        agent={agent({ adapterType: 'opencode_local', adapterConfig: { model: 'opencode-go/kimi-k3' } }) as never}
        companyId="c-tps"
      />,
    );
    fireEvent.keyDown(await openable(), { key: 'Enter' });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'opencode-go/deepseek-v4-flash',
      'opencode-go/glm-5.3',
      'opencode-go/kimi-k3',
    ]);
  });

  it('model Claude trên agent Codex là ngoài bảng của runtime', async () => {
    mockServer({});
    renderWith(
      <ModelSelect
        agent={agent({ adapterType: 'codex_local', adapterConfig: { model: 'claude-sonnet-5-5' } }) as never}
        companyId="c-tps"
      />,
    );
    expect(await screen.findByText('Model hiện tại (claude-sonnet-5-5) không nằm trong bảng model Crew.')).toBeTruthy();
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
