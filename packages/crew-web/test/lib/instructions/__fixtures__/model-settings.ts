// Bảng cài đặt model mẫu cho test: đúng giá trị mặc định của server (`CREW_MODEL_SETTINGS_DEFAULT`), tức bảng prod
// khi chưa ai lưu bản nào. `catalog-copy.test.ts` so khớp bản này với server nên không lệch.
import type { ModelSettings, ModelSettingsView } from '@/api';

export const SETTINGS: ModelSettings = {
  catalog: {
    claude_local: {
      effortKey: 'effort',
      models: {
        'claude-sonnet-5-5': { vision: true },
        'claude-opus-5-5': { vision: true },
        'claude-sonnet-5': { vision: true },
        'claude-opus-5': { vision: true },
      },
      byComplexity: {
        trivial: { model: 'claude-sonnet-5-5', effort: 'low' },
        small: { model: 'claude-sonnet-5-5', effort: 'medium' },
        medium: { model: 'claude-sonnet-5-5', effort: 'high' },
        large: { model: 'claude-opus-5-5', effort: 'high' },
      },
    },
    codex_local: {
      effortKey: 'modelReasoningEffort',
      models: { 'gpt-6-luna': { vision: true }, 'gpt-6-sol': { vision: true } },
      byComplexity: {
        trivial: { model: 'gpt-6-luna', effort: 'low' },
        small: { model: 'gpt-6-luna', effort: 'medium' },
        medium: { model: 'gpt-6-sol', effort: 'high' },
      },
    },
    opencode_local: {
      effortKey: null,
      models: {
        'opencode-go/deepseek-v4-flash': { vision: false },
        'opencode-go/kimi-k3': { vision: false },
        'opencode-go/glm-5.3': { vision: false },
      },
      byComplexity: {
        trivial: { model: 'opencode-go/deepseek-v4-flash', effort: null },
        small: { model: 'opencode-go/kimi-k3', effort: null },
        medium: { model: 'opencode-go/glm-5.3', effort: null },
      },
    },
  },
  order: {
    trivial: ['opencode_local', 'claude_local', 'codex_local'],
    small: ['opencode_local', 'claude_local', 'codex_local'],
    medium: ['claude_local', 'codex_local', 'opencode_local'],
    large: ['claude_local'],
  },
  roles: {
    assistant: { model: 'claude-opus-5-5', effort: null },
    executor: { model: 'claude-sonnet-5-5', effort: null },
    reviewer: { model: 'claude-sonnet-5-5', effort: null },
    integrator: { model: 'claude-sonnet-5-5', effort: null },
    bmad: { model: 'claude-opus-5-5', effort: null },
    'executor-codex': { model: 'gpt-6-luna', effort: 'medium' },
    'executor-opencode': { model: 'opencode-go/kimi-k3', effort: null },
    'reviewer-codex': { model: 'gpt-6-sol', effort: 'high' },
    'reviewer-root': { model: 'claude-opus-5-5', effort: 'high' },
  },
};

export const SETTINGS_VIEW: ModelSettingsView = {
  revision: 0,
  updatedAt: null,
  updatedByUserId: null,
  settings: SETTINGS,
  canEdit: false,
};
