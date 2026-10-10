import { describe, expect, it } from 'vitest';
import { type AddAgentForm, validateAddAgent } from '@/features/wizards/add-agent/validate';

const FORM: AddAgentForm = {
  projectId: 'p1',
  slot: 'executor-2',
  name: 'demo-executor-2',
  model: 'claude-sonnet-5',
  machineId: 'm1',
  key: 'demo',
  folder: '/Users/owner/code/demo',
};
const ctx = (over: Partial<Parameters<typeof validateAddAgent>[1]> = {}) => ({
  companyName: '2P Solutions',
  agents: [{ name: 'demo-executor', status: 'idle' }],
  fix: false,
  ...over,
});

describe('validateAddAgent', () => {
  it('form đúng thì không lỗi', () => {
    expect(validateAddAgent(FORM, ctx())).toEqual({});
  });

  it('thiếu project, máy; ô và model lạ', () => {
    expect(validateAddAgent({ ...FORM, projectId: '', machineId: '', slot: 'ceo', model: 'gpt' }, ctx())).toEqual({
      projectId: 'validate.project',
      machineId: 'validate.machine',
      slot: 'validate.slot',
      model: 'validate.model',
    });
  });

  it('tên trống hoặc trùng agent đang có (trừ agent đã dừng hẳn); chế độ sửa không kiểm tên', () => {
    expect(validateAddAgent({ ...FORM, name: '  ' }, ctx()).name).toBe('validate.agentName');
    expect(validateAddAgent({ ...FORM, name: 'demo-executor' }, ctx()).name).toBe('validate.agentNameTaken');
    expect(
      validateAddAgent(
        { ...FORM, name: 'demo-executor' },
        ctx({ agents: [{ name: 'demo-executor', status: 'terminated' }] }),
      ).name,
    ).toBeUndefined();
    expect(validateAddAgent({ ...FORM, name: 'demo-executor' }, ctx({ fix: true })).name).toBeUndefined();
  });

  it('khóa sai dạng; khóa e2e-* chỉ ở company Crew E2E', () => {
    expect(validateAddAgent({ ...FORM, key: 'Demo' }, ctx()).key).toBe('validate.key');
    expect(validateAddAgent({ ...FORM, key: 'e2e-demo' }, ctx()).key).toBe('validate.e2eKey');
    expect(validateAddAgent({ ...FORM, key: 'e2e-demo' }, ctx({ companyName: 'Crew E2E' })).key).toBeUndefined();
  });

  it.each(['code/demo', '/a/../b', `/${'a'.repeat(200)}`, '/a\u0007b'])('folder sai: %s', (folder) => {
    expect(validateAddAgent({ ...FORM, folder }, ctx()).folder).toBe('validate.agentFolder');
  });

  it('model theo runtime của ô; reviewer Codex chỉ gpt-6-sol', () => {
    expect(validateAddAgent({ ...FORM, slot: 'executor-codex', model: 'gpt-6-luna' }, ctx())).toEqual({});
    expect(validateAddAgent({ ...FORM, slot: 'executor-codex', model: 'claude-sonnet-5' }, ctx()).model).toBe(
      'validate.model',
    );
    expect(validateAddAgent({ ...FORM, slot: 'executor-opencode', model: 'opencode-go/glm-5.3' }, ctx())).toEqual({});
    expect(validateAddAgent({ ...FORM, slot: 'reviewer-codex', model: 'gpt-6-luna' }, ctx()).model).toBe(
      'validate.model',
    );
    expect(validateAddAgent({ ...FORM, slot: 'reviewer-codex', model: 'gpt-6-sol' }, ctx())).toEqual({});
  });
});
