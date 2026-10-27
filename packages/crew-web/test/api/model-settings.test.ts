import { describe, expect, it } from 'vitest';
import { ApiError, api, modelSettingsErrorOf } from '@/api';
import { mockServer } from '../app/fetch-mock';
import { SETTINGS, SETTINGS_VIEW } from '../lib/instructions/__fixtures__/model-settings';

const PATH = '/api/crew/model-settings';

describe('modelSettings client', () => {
  it('get đọc bảng hiện hành, không có companyId', async () => {
    const { calls } = mockServer({ [`GET ${PATH}`]: { body: { ...SETTINGS_VIEW, revision: 3, canEdit: true } } });
    const view = await api.modelSettings.get();
    expect(view.revision).toBe(3);
    expect(view.canEdit).toBe(true);
    expect(view.settings).toEqual(SETTINGS);
    expect(calls[0]).toMatchObject({ method: 'GET', url: PATH });
  });

  it('save gửi baseRevision, settings và dryRun khi được bảo; không gửi dryRun khi không bảo', async () => {
    const result = { revision: 4, settings: SETTINGS, applied: { agents: [], skipped: [] }, dryRun: true };
    const { calls } = mockServer({ [`PUT ${PATH}`]: { body: result } });
    expect(await api.modelSettings.save({ baseRevision: 3, settings: SETTINGS }, { dryRun: true })).toEqual(result);
    await api.modelSettings.save({ baseRevision: 3, settings: SETTINGS });
    expect(calls[0]).toMatchObject({ method: 'PUT', body: { baseRevision: 3, settings: SETTINGS, dryRun: true } });
    expect(calls[1]?.body).toEqual({ baseRevision: 3, settings: SETTINGS });
  });

  it('upgrade gửi runtime, model cũ, model mới, vision và dryRun tới /upgrade', async () => {
    const result = {
      revision: 4,
      settings: SETTINGS,
      changes: { catalog: 'renamed', cells: [], roles: [], agents: [], skipped: [], issues: [] },
      dryRun: true,
    };
    const { calls } = mockServer({ [`POST ${PATH}/upgrade`]: { body: result } });
    const input = {
      baseRevision: 3,
      runtime: 'claude_local',
      fromModel: 'claude-sonnet-5',
      toModel: 'claude-sonnet-5-5',
      vision: true,
    } as const;
    expect(await api.modelSettings.upgrade(input, { dryRun: true })).toEqual(result);
    expect(calls[0]).toMatchObject({ method: 'POST', url: `${PATH}/upgrade`, body: { ...input, dryRun: true } });
  });
});

describe('modelSettingsErrorOf', () => {
  const failing = async (status: number, body: unknown) => {
    mockServer({ [`PUT ${PATH}`]: { status, body } });
    try {
      await api.modelSettings.save({ baseRevision: 0, settings: SETTINGS });
    } catch (error) {
      return modelSettingsErrorOf(error);
    }
    throw new Error('phải lỗi');
  };

  it('422 sai luật giữ path từng trường', async () => {
    const issues = [{ path: 'catalog.codex_local.byComplexity.small.model', message: 'Model không có trong catalog.' }];
    expect(await failing(422, { error: 'Bảng sai', code: 'crew_model_settings_invalid', issues })).toEqual({
      kind: 'invalid',
      status: 422,
      message: 'Bảng sai',
      issues,
    });
  });

  it('422 gỡ model đang dùng trả số agent và issue', async () => {
    const inUse = [{ runtime: 'claude_local', model: 'claude-sonnet-5', agents: 8, issues: 1 }];
    expect(await failing(422, { error: 'Đang dùng', code: 'crew_model_in_use', inUse })).toEqual({
      kind: 'in_use',
      message: 'Đang dùng',
      inUse,
    });
  });

  it('409 trả bản hiện hành, 403 và 503 theo mã', async () => {
    expect(await failing(409, { error: 'Cũ', code: 'crew_model_settings_stale', currentRevision: 7 })).toEqual({
      kind: 'stale',
      message: 'Cũ',
      currentRevision: 7,
    });
    expect((await failing(403, { error: 'Không', code: 'crew_model_settings_forbidden' })).kind).toBe('forbidden');
    expect((await failing(503, { error: 'Chưa', code: 'crew_model_settings_unavailable' })).kind).toBe('unavailable');
  });

  it('lỗi mạng và lỗi lạ thành other, giữ câu lỗi', () => {
    expect(modelSettingsErrorOf(new ApiError(0, 'mất mạng', 'network'))).toEqual({
      kind: 'other',
      status: 0,
      message: 'mất mạng',
    });
    expect(modelSettingsErrorOf(new Error('x'))).toEqual({ kind: 'other', status: 0, message: 'x' });
  });
});
