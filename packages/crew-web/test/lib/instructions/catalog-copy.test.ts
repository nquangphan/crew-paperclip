// Bảng model của crew-web không còn bản chép: danh sách chọn, model mặc định và effort lấy từ `settings` (bảng cài đặt
// model của owner). Test này kiểm các hàm thuần với bảng mẫu, bảng mẫu khớp mặc định của server, và src không còn id
// model ghi cứng.
import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ModelSettings } from '@/api';
import {
  crewAgentCreateBody,
  crewModelsOf,
  defaultEffortOf,
  defaultModelOf,
  isCrewModel,
  modelRoleOfSlot,
  slotModels,
  sortModelIds,
} from '@/lib/instructions';
import * as server from '../../../../../server/src/crew/model-policy';
import { SETTINGS } from './__fixtures__/model-settings';

const PIN = '/Users/owner/.crew/workflows/superpowers/6.4.1-5bf4e7801107';

describe('bảng mẫu của test', () => {
  it('khớp catalog và thứ tự mặc định của server', () => {
    expect(SETTINGS.catalog).toEqual(server.CREW_RUNTIME_CATALOG);
    expect(SETTINGS.order).toEqual(server.CREW_RUNTIME_ORDER);
    expect(SETTINGS.roles['reviewer-codex']).toEqual(server.CREW_CODEX_REVIEWER_MODEL);
  });
});

describe('hàm thuần với bảng mặc định cho kết quả như các hằng số cũ', () => {
  it('danh sách model theo runtime là catalog của runtime, sắp theo id', () => {
    expect(crewModelsOf('claude_local', SETTINGS)).toEqual([
      'claude-opus-5',
      'claude-opus-5-5',
      'claude-sonnet-5',
      'claude-sonnet-5-5',
    ]);
    expect(crewModelsOf('codex_local', SETTINGS)).toEqual(['gpt-6-luna', 'gpt-6-sol']);
    expect(slotModels('executor-opencode', SETTINGS)).toEqual([
      'opencode-go/deepseek-v4-flash',
      'opencode-go/glm-5.3',
      'opencode-go/kimi-k3',
    ]);
    expect(slotModels('reviewer-codex', SETTINGS)).toEqual(['gpt-6-sol']);
  });

  it('model mặc định theo vai, executor-2 dùng vai executor', () => {
    expect(defaultModelOf('assistant', SETTINGS)).toBe('claude-opus-5-5');
    for (const slot of ['executor', 'executor-2', 'reviewer', 'integrator'] as const) {
      expect(defaultModelOf(slot, SETTINGS)).toBe('claude-sonnet-5-5');
    }
    expect(defaultModelOf('executor-codex', SETTINGS)).toBe('gpt-6-luna');
    expect(defaultModelOf('executor-opencode', SETTINGS)).toBe('opencode-go/kimi-k3');
    expect(defaultModelOf('reviewer-codex', SETTINGS)).toBe('gpt-6-sol');
    expect(modelRoleOfSlot('executor-2')).toBe('executor');
    expect(defaultEffortOf('executor-codex', SETTINGS)).toBe('medium');
    expect(defaultEffortOf('reviewer-codex', SETTINGS)).toBe('high');
    expect(defaultEffortOf('executor', SETTINGS)).toBeNull();
  });

  it('body agent Codex mang effort của vai, agent Claude và OpenCode không có key effort', () => {
    const codex = crewAgentCreateBody({
      name: 'r',
      slot: 'reviewer-codex',
      model: 'gpt-6-sol',
      settings: SETTINGS,
      pinDir: PIN,
      projectKey: 'demo',
    });
    expect(codex.adapterConfig).toMatchObject({ model: 'gpt-6-sol', modelReasoningEffort: 'high' });
    const luna = crewAgentCreateBody({
      name: 'x',
      slot: 'executor-codex',
      model: 'gpt-6-luna',
      settings: SETTINGS,
      pinDir: PIN,
      projectKey: 'demo',
    });
    expect(luna.adapterConfig).toMatchObject({ modelReasoningEffort: 'medium' });
    for (const [slot, model] of [
      ['executor', 'claude-sonnet-5-5'],
      ['executor-opencode', 'opencode-go/kimi-k3'],
    ] as const) {
      const body = crewAgentCreateBody({ name: 'x', slot, model, settings: SETTINGS, pinDir: PIN });
      expect(body.adapterConfig).not.toHaveProperty('effort');
      expect(body.adapterConfig).not.toHaveProperty('modelReasoningEffort');
    }
  });
});

describe('thứ tự model không phụ thuộc thứ tự khóa jsonb', () => {
  it('sắp id tăng dần kiểu natural sort', () => {
    expect(sortModelIds(['opencode-go/glm-5.10', 'opencode-go/kimi-k3', 'opencode-go/glm-5.3'])).toEqual([
      'opencode-go/glm-5.3',
      'opencode-go/glm-5.10',
      'opencode-go/kimi-k3',
    ]);
  });

  it('bảng đọc lại từ jsonb (khóa theo độ dài) cho cùng danh sách như bảng mặc định', () => {
    const reordered: ModelSettings = structuredClone(SETTINGS);
    reordered.catalog.opencode_local.models = {
      'opencode-go/glm-5.3': { vision: false },
      'opencode-go/kimi-k3': { vision: false },
      'opencode-go/deepseek-v4-flash': { vision: false },
    };
    expect(crewModelsOf('opencode_local', reordered)).toEqual(crewModelsOf('opencode_local', SETTINGS));
  });
});

describe('hàm thuần theo bảng do owner sửa', () => {
  const custom: ModelSettings = structuredClone(SETTINGS);
  custom.catalog.claude_local.models = { 'claude-next-1': { vision: true }, 'claude-next-2': { vision: false } };
  custom.roles.executor = { model: 'claude-next-2', effort: 'low' };
  custom.roles['reviewer-codex'] = { model: 'gpt-next', effort: 'medium' };
  custom.catalog.codex_local.models = { 'gpt-next': { vision: true } };

  it('danh sách và mặc định đi theo bảng, không còn id cũ', () => {
    expect(crewModelsOf('claude_local', custom)).toEqual(['claude-next-1', 'claude-next-2']);
    expect(isCrewModel('claude-next-1', custom)).toBe(true);
    expect(isCrewModel('claude-sonnet-5-5', custom)).toBe(false);
    expect(defaultModelOf('executor-2', custom)).toBe('claude-next-2');
    expect(slotModels('reviewer-codex', custom)).toEqual(['gpt-next']);
  });

  it('tạo agent từ chối model ngoài catalog và ghi effort của vai vào key effort của runtime', () => {
    expect(() =>
      crewAgentCreateBody({
        name: 'x',
        role: 'executor',
        model: 'claude-sonnet-5-5',
        settings: custom,
        pinDir: PIN,
      }),
    ).toThrow(/danh sách model Crew/);
    const body = crewAgentCreateBody({
      name: 'x',
      role: 'executor',
      model: 'claude-next-2',
      settings: custom,
      pinDir: PIN,
    });
    expect(body.adapterConfig).toMatchObject({ model: 'claude-next-2', effort: 'low' });
  });
});

describe('src không ghi cứng id model', () => {
  it('không file nào ngoài ví dụ nhãn và trang showcase còn id model', () => {
    const allowed = new Set([
      'src/dev/crew-showcase.tsx',
      'src/ds/widgets/roadmap/roadmap-runs.ts',
      'src/ds/widgets/roadmap/roadmap-types.ts',
    ]);
    const re = /claude-(sonnet|opus)-5|gpt-6-|opencode-go\//;
    const hits = globSync('src/**/*.{ts,tsx,json}', { cwd: process.cwd() })
      .filter((file) => !allowed.has(file) && re.test(readFileSync(file, 'utf8')))
      .sort();
    expect(hits).toEqual([]);
  });
});
