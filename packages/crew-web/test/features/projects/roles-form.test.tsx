// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type RoleAgent, RolesForm, roleOptions } from '@/features/projects/detail/roles-form';
import { initI18n, setLanguage } from '@/i18n';
import { ID, ROLES } from './helpers';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  // Radix Select cần các hàm này mà jsdom chưa có.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

const agent = (
  id: string,
  name: string,
  state: RoleAgent['state'],
  holdsElsewhere = false,
  adapterType = 'claude_local',
): RoleAgent => ({
  id,
  name,
  state,
  holdsElsewhere,
  adapterType,
});
const CODEX = 'f8888888-8888-4888-8888-888888888888';
const OPENCODE = 'f9999999-9999-4999-8999-999999999999';
const NO_RUNTIME = { codexExecutorAgentId: null, opencodeExecutorAgentId: null, codexReviewerAgentId: null };

const AGENTS = [
  agent(ID.assistant, 'Trợ Lý', 'ready'),
  agent(ID.executor, 'Executor Một', 'ready'),
  agent(ID.executor2, 'Executor Hai', 'ready'),
  agent(ID.reviewer, 'Reviewer', 'ready'),
  agent(ID.integrator, 'Integrator', 'ready'),
  agent(ID.spare, 'Agent Dở', 'not_ready'),
];

describe('roleOptions', () => {
  it('chỉ có agent ready, hoặc agent đang giữ đúng vai trò đó', () => {
    const ids = (list: RoleAgent[]) => list.map((a) => a.id);
    expect(ids(roleOptions(AGENTS, null))).not.toContain(ID.spare);
    expect(ids(roleOptions(AGENTS, ID.spare))).toContain(ID.spare);
  });
  it('bỏ agent đang giữ vai trò ở project khác, trừ khi chính là người đang giữ ô này', () => {
    const list = [agent(ID.spare, 'Bận', 'ready', true), agent(ID.executor, 'Rảnh', 'ready')];
    expect(roleOptions(list, null).map((a) => a.id)).toEqual([ID.executor]);
    expect(roleOptions(list, ID.spare).map((a) => a.id)).toEqual([ID.spare, ID.executor]);
  });
  it('ô Claude không nhận agent Codex/OpenCode; ô runtime chỉ nhận đúng adapter', () => {
    const list = [
      agent(ID.executor, 'Claude', 'ready'),
      agent(CODEX, 'Codex', 'ready', false, 'codex_local'),
      agent(OPENCODE, 'OpenCode', 'ready', false, 'opencode_local'),
    ];
    const ids = (l: RoleAgent[]) => l.map((a) => a.id);
    expect(ids(roleOptions(list, null))).toEqual([ID.executor]);
    expect(ids(roleOptions(list, null, 'codex_local'))).toEqual([CODEX]);
    expect(ids(roleOptions(list, null, 'opencode_local'))).toEqual([OPENCODE]);
  });
  it('agent tạm dừng, đã dừng hẳn không được chọn mới', () => {
    const list = [agent(ID.spare, 'A', 'paused'), agent(ID.executor, 'B', 'terminated')];
    expect(roleOptions(list, null)).toEqual([]);
  });
});

describe('RolesForm', () => {
  it('hộp chọn Reviewer không có agent not_ready (S13.7)', () => {
    render(<RolesForm roles={ROLES} agents={AGENTS} saving={false} error={null} onSubmit={() => {}} />);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Reviewer' }), { key: 'Enter' });
    expect(screen.queryByRole('option', { name: 'Agent Dở' })).toBeNull();
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
  });

  it('chưa đổi gì thì nút Lưu tắt; hiện lỗi server nguyên văn trên form', () => {
    render(
      <RolesForm
        roles={ROLES}
        agents={AGENTS}
        saving={false}
        error="Reviewer không được trùng Integrator"
        onSubmit={() => {}}
      />,
    );
    expect((screen.getByRole('button', { name: 'Lưu vai trò' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Reviewer không được trùng Integrator')).toBeTruthy();
  });

  it('đổi Executor 2 rồi Lưu → onSubmit nhận bộ vai trò mới', () => {
    const onSubmit = vi.fn();
    render(<RolesForm roles={ROLES} agents={AGENTS} saving={false} error={null} onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Executor 2 (tùy chọn)' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'Executor Hai' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu vai trò' }));
    expect(onSubmit).toHaveBeenCalledWith({ ...ROLES, ...NO_RUNTIME, executorAgentIds: [ID.executor, ID.executor2] });
  });

  it('ô runtime: chọn executor Codex, bỏ reviewer Codex đang có → gửi id và null', () => {
    const onSubmit = vi.fn();
    const agents = [
      ...AGENTS,
      agent(CODEX, 'Codex Một', 'ready', false, 'codex_local'),
      agent(OPENCODE, 'OpenCode Một', 'ready', false, 'opencode_local'),
    ];
    const roles = { ...ROLES, codexReviewerAgentId: CODEX };
    render(<RolesForm roles={roles} agents={agents} saving={false} error={null} onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Executor OpenCode (tùy chọn)' }), { key: 'Enter' });
    expect(screen.queryByRole('option', { name: 'Codex Một' })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'OpenCode Một' }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Reviewer Codex (tùy chọn)' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'Không có' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu vai trò' }));
    expect(onSubmit).toHaveBeenCalledWith({
      ...ROLES,
      codexExecutorAgentId: null,
      opencodeExecutorAgentId: OPENCODE,
      codexReviewerAgentId: null,
    });
  });
});
