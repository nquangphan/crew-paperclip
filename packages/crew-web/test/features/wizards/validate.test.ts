import { describe, expect, it } from 'vitest';
import { type AddProjectForm, validateAddProject } from '@/features/wizards/add-project/validate';

const FORM: AddProjectForm = {
  machineId: 'm1',
  folder: '/Users/owner/code/demo',
  key: 'demo',
  name: 'Demo',
  executors: 1,
};
const ctx = (over: Partial<Parameters<typeof validateAddProject>[1]> = {}) => ({
  companyName: '2P Solutions',
  projects: [] as { name: string; urlKey?: string | null }[],
  ...over,
});

describe('validateAddProject', () => {
  it('form đúng thì không lỗi', () => {
    expect(validateAddProject(FORM, ctx())).toEqual({});
  });

  it.each(['D', 'a', '1abc', 'ab_c', 'a'.repeat(32), '-ab'])('khóa sai dạng: %s', (key) => {
    expect(validateAddProject({ ...FORM, key }, ctx()).key).toBe('validate.key');
  });

  it.each(['ab', 'demo-2', `a${'b'.repeat(30)}`])('khóa đúng dạng: %s', (key) => {
    expect(validateAddProject({ ...FORM, key }, ctx()).key).toBeUndefined();
  });

  it('khóa e2e-* ở company khác Crew E2E bị từ chối', () => {
    expect(validateAddProject({ ...FORM, key: 'e2e-demo' }, ctx()).key).toBe('validate.e2eKey');
    expect(validateAddProject({ ...FORM, key: 'e2e-demo' }, ctx({ companyName: 'Crew E2E' })).key).toBeUndefined();
  });

  it('khóa trùng project có sẵn (urlKey hoặc tên) bị từ chối', () => {
    expect(validateAddProject(FORM, ctx({ projects: [{ name: 'Khác', urlKey: 'demo' }] })).key).toBe(
      'validate.keyTaken',
    );
    expect(validateAddProject(FORM, ctx({ projects: [{ name: 'Demo', urlKey: null }] })).key).toBe('validate.keyTaken');
    expect(validateAddProject(FORM, ctx({ projects: [{ name: 'Alpha', urlKey: 'alpha' }] })).key).toBeUndefined();
  });

  it('khóa của project đã gỡ (archive) bị từ chối với lời báo riêng', () => {
    const archived = { name: 'Demo cũ', urlKey: 'demo', archivedAt: '2026-10-10T03:00:00.000Z' };
    expect(validateAddProject(FORM, ctx({ projects: [archived] })).key).toBe('validate.keyRemoved');
    expect(validateAddProject(FORM, ctx({ projects: [{ ...archived, archivedAt: null }] })).key).toBe(
      'validate.keyTaken',
    );
  });

  it('khóa trùng tên environment <khóa>-<ô> đã có (kể cả đã lưu trữ) bị từ chối', () => {
    const env = (name: string, status: string) => ({ environments: [{ name, status }] });
    expect(validateAddProject(FORM, ctx(env('demo-assistant', 'archived'))).key).toBe('validate.keyRemoved');
    expect(validateAddProject(FORM, ctx(env('demo-executor-2', 'archived'))).key).toBe('validate.keyRemoved');
    expect(validateAddProject(FORM, ctx(env('demo-reviewer', 'active'))).key).toBe('validate.keyEnvTaken');
    // Khóa khác có tiền tố giống: không trùng.
    expect(validateAddProject(FORM, ctx(env('demo-2-assistant', 'archived'))).key).toBeUndefined();
    expect(validateAddProject(FORM, ctx(env('demo', 'active'))).key).toBeUndefined();
  });

  it('số executor chỉ 1 hoặc 2', () => {
    expect(validateAddProject({ ...FORM, executors: 0 }, ctx()).executors).toBe('validate.executors');
    expect(validateAddProject({ ...FORM, executors: 3 }, ctx()).executors).toBe('validate.executors');
    expect(validateAddProject({ ...FORM, executors: 2 }, ctx()).executors).toBeUndefined();
  });

  it('tên 1–120 ký tự', () => {
    expect(validateAddProject({ ...FORM, name: '   ' }, ctx()).name).toBe('validate.name');
    expect(validateAddProject({ ...FORM, name: 'x'.repeat(121) }, ctx()).name).toBe('validate.name');
    expect(validateAddProject({ ...FORM, name: 'x'.repeat(120) }, ctx()).name).toBeUndefined();
  });

  it.each(['', 'code/demo', '/Users/a/../b', '/Users/a\u0001b', `/${'a'.repeat(4096)}`])('folder sai: %j', (folder) => {
    expect(validateAddProject({ ...FORM, folder }, ctx()).folder).toBe('validate.folder');
  });

  it('chưa chọn máy', () => {
    expect(validateAddProject({ ...FORM, machineId: '' }, ctx()).machineId).toBe('validate.machine');
  });
});
