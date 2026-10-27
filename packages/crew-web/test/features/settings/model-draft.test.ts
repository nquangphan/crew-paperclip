import { describe, expect, it } from 'vitest';
import {
  addModel,
  cloneSettings,
  errorAt,
  isUsed,
  modelUsage,
  moveRuntime,
  removeModel,
  sameSettings,
  setCell,
  setEffortKey,
  setRole,
  toggleRuntime,
} from '@/features/settings/models/model-draft';
import { SETTINGS } from '../../lib/instructions/__fixtures__/model-settings';

const base = () => cloneSettings(SETTINGS);

describe('model-draft', () => {
  it('sameSettings bỏ qua thứ tự khóa đối tượng nhưng giữ thứ tự mảng', () => {
    const a = base();
    const reordered = JSON.parse(JSON.stringify(a), (_k, v) =>
      v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v,
    );
    expect(sameSettings(a, reordered)).toBe(true);
    expect(sameSettings(a, moveRuntime(a, 'small', 'claude_local', -1))).toBe(false);
  });

  it('thêm rồi gỡ model trả về đúng bản cũ và không đổi bản gốc', () => {
    const a = base();
    const added = addModel(a, 'opencode_local', 'e2e-x', true);
    expect(added.catalog.opencode_local.models['e2e-x']).toEqual({ vision: true });
    expect(a.catalog.opencode_local.models['e2e-x']).toBeUndefined();
    expect(sameSettings(removeModel(added, 'opencode_local', 'e2e-x'), a)).toBe(true);
  });

  it('modelUsage tìm ô bảng độ khó và vai đang dùng model', () => {
    const u = modelUsage(SETTINGS, 'claude_local', 'claude-opus-5-5');
    expect(u.levels).toEqual(['large']);
    expect(u.roles).toEqual(['assistant', 'bmad', 'reviewer-root']);
    expect(isUsed(modelUsage(SETTINGS, 'claude_local', 'claude-sonnet-5'))).toBe(false);
  });

  it('tắt runtime gỡ khỏi thứ tự và xóa ô; bật lại thêm cuối thứ tự với ô mặc định', () => {
    const off = toggleRuntime(base(), 'small', 'claude_local', false);
    expect(off.order.small).toEqual(['opencode_local', 'codex_local']);
    expect(off.catalog.claude_local.byComplexity.small).toBeUndefined();
    const on = toggleRuntime(off, 'small', 'claude_local', true);
    expect(on.order.small).toEqual(['opencode_local', 'codex_local', 'claude_local']);
    expect(on.catalog.claude_local.byComplexity.small).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' });
  });

  it('bật runtime ở mức large chọn model xem được ảnh; runtime không effort thì effort null', () => {
    const s = base();
    s.catalog.claude_local.models = { 'no-vision': { vision: false }, 'sees-1': { vision: true } };
    const on = toggleRuntime(toggleRuntime(s, 'large', 'claude_local', false), 'large', 'claude_local', true);
    expect(on.catalog.claude_local.byComplexity.large?.model).toBe('sees-1');
    expect(toggleRuntime(base(), 'large', 'opencode_local', true).catalog.opencode_local.byComplexity.large).toEqual({
      model: 'opencode-go/deepseek-v4-flash',
      effort: null,
    });
  });

  it('moveRuntime đổi chỗ hai runtime liền kề và dừng ở biên', () => {
    const s = moveRuntime(base(), 'medium', 'claude_local', 1);
    expect(s.order.medium).toEqual(['codex_local', 'claude_local', 'opencode_local']);
    expect(moveRuntime(s, 'medium', 'codex_local', -1)).toBe(s);
  });

  it('setEffortKey null xóa effort của ô và vai; có key lại thì ô bắt buộc nhận medium', () => {
    const none = setEffortKey(base(), 'codex_local', null);
    expect(none.catalog.codex_local.effortKey).toBeNull();
    expect(Object.values(none.catalog.codex_local.byComplexity).map((c) => c.effort)).toEqual([null, null, null]);
    expect(none.roles['executor-codex'].effort).toBeNull();
    expect(none.roles['reviewer-codex'].effort).toBeNull();
    const back = setEffortKey(none, 'codex_local', 'modelReasoningEffort');
    expect(back.catalog.codex_local.byComplexity.small?.effort).toBe('medium');
    expect(back.roles['reviewer-codex'].effort).toBe('medium');
    expect(back.roles.assistant.effort).toBeNull();
  });

  it('setCell và setRole chỉ đổi đúng ô', () => {
    const s = setRole(setCell(base(), 'claude_local', 'small', { effort: 'high' }), 'executor', {
      model: 'claude-opus-5-5',
    });
    expect(s.catalog.claude_local.byComplexity.small).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' });
    expect(s.roles.executor).toEqual({ model: 'claude-opus-5-5', effort: null });
    expect(setCell(base(), 'claude_local', 'large', {}).catalog.claude_local.byComplexity.large).toBeTruthy();
  });

  it('errorAt khớp lỗi đúng ô, ô cha và (khi deep) ô con; lỗi cả bảng không gắn vào ô nào', () => {
    const issues = [
      { path: 'order.large', message: 'a' },
      { path: 'catalog.opencode_local.models.opencode-go/glm-5.3.vision', message: 'b' },
      { path: '', message: 'c' },
    ];
    expect(errorAt(issues, 'order.large')).toBe('a');
    expect(errorAt(issues, 'order.large.0')).toBe('a');
    expect(errorAt(issues, 'order.small')).toBeUndefined();
    const row = 'catalog.opencode_local.models.opencode-go/glm-5.3';
    expect(errorAt(issues, row)).toBeUndefined();
    expect(errorAt(issues, row, true)).toBe('b');
    expect(errorAt(issues, 'roles.bmad')).toBeUndefined();
  });
});
