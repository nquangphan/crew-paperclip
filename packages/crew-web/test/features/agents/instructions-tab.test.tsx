// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { InstructionsTab } from '@/features/agents/detail/instructions-tab';
import { initI18n, setLanguage } from '@/i18n';
import { renderInstructions } from '@/lib/instructions';
import { mockServer } from '../../app/fetch-mock';
import { agent, data, ID, project, ROLES, renderWith } from './helpers';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const FILE = `/api/agents/${ID.assistant}/instructions-bundle/file`;
const assistant = () => agent({ id: ID.assistant, name: 'Trợ Lý' }) as never;

function server(extra: Record<string, unknown> = {}) {
  return mockServer({
    'GET /api/companies/c-tps/projects': { body: [project()] },
    'GET /api/plugins/crew.core/api/projects/p1/roles': { body: { roles: ROLES } },
    [`GET ${FILE}`]: { body: { path: 'AGENTS.md', content: '# Cũ\n', contentHash: 'h-cu' } },
    [`PUT ${FILE}`]: { body: { path: 'AGENTS.md', content: 'mới', contentHash: 'h-moi' } },
    ...data('crew.setupRuns', []),
    ...(extra as Record<string, never>),
  });
}

describe('InstructionsTab', () => {
  it('S11.2: nội dung chỉ đọc, không có ô sửa', async () => {
    server();
    renderWith(<InstructionsTab agent={assistant()} companyId="c-tps" />);
    expect(await screen.findByRole('heading', { name: 'Cũ' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Render lại theo vai trò: render theo vai trò Trợ Lý rồi PUT có baseHash', async () => {
    const s = server();
    renderWith(<InstructionsTab agent={assistant()} companyId="c-tps" />);
    const button = await screen.findByRole('button', { name: 'Render lại theo vai trò' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(s.calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = s.calls.find((c) => c.method === 'PUT')?.body as { path: string; content: string; baseHash: string };
    expect(put.path).toBe('AGENTS.md');
    expect(put.baseHash).toBe('h-cu');
    expect(put.content).toBe(renderInstructions('assistant', { agentId: ID.assistant, executorIds: [ID.executor] }));
    expect(await screen.findByText('Đã render lại hướng dẫn theo vai trò.')).toBeTruthy();
  });

  it('agent vai trò executor render template executor, không danh sách executor', async () => {
    const file = `/api/agents/${ID.executor}/instructions-bundle/file`;
    const s = server({
      [`GET ${file}`]: { body: { path: 'AGENTS.md', content: '# Cũ\n', contentHash: 'h-cu' } },
      [`PUT ${file}`]: { body: { path: 'AGENTS.md', content: 'x', contentHash: 'h2' } },
    });
    renderWith(<InstructionsTab agent={agent() as never} companyId="c-tps" />);
    const button = await screen.findByRole('button', { name: 'Render lại theo vai trò' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(s.calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = s.calls.find((c) => c.method === 'PUT')?.body as { content: string };
    expect(put.content).toBe(renderInstructions('executor', { agentId: ID.executor }));
  });

  it('xung đột 409 hiện cảnh báo, không ghi đè và có nút tải lại', async () => {
    const s = server({ [`PUT ${FILE}`]: { status: 409, body: { error: 'Hash cũ' } } });
    renderWith(<InstructionsTab agent={assistant()} companyId="c-tps" />);
    const button = await screen.findByRole('button', { name: 'Render lại theo vai trò' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    expect(await screen.findByText(/Có người vừa sửa hướng dẫn/)).toBeTruthy();
    expect(s.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Tải lại' })).toBeTruthy();
  });

  it('agent chưa giữ vai trò nào thì không render lại được', async () => {
    server({ 'GET /api/plugins/crew.core/api/projects/p1/roles': { body: { roles: null } } });
    renderWith(<InstructionsTab agent={agent({ id: ID.spare }) as never} companyId="c-tps" />);
    expect(await screen.findByText(/chưa giữ vai trò/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Render lại theo vai trò' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('file chưa có (404) thì báo trống và vẫn render lại được', async () => {
    const file = `/api/agents/${ID.executor}/instructions-bundle/file`;
    server({
      [`GET ${file}`]: { status: 404, body: { error: 'Not found' } },
      [`PUT ${file}`]: { body: { contentHash: 'h' } },
    });
    renderWith(<InstructionsTab agent={agent() as never} companyId="c-tps" />);
    expect(await screen.findByText('Agent chưa có AGENTS.md.')).toBeTruthy();
  });
});
