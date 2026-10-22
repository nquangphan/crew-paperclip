import { describe, expect, it } from 'vitest';
import { parseSettingsForm } from '@/features/jev/settings-form';

const ok = {
  enabled: true,
  gateMode: 'enforce' as const,
  model: ' typesafe/jev-1.14 ',
  threshold: '0.5',
  timeoutMs: '2500',
  serverShadow: true,
};

describe('parseSettingsForm', () => {
  it('đọc ô nhập thành cấu hình, cắt khoảng trắng của model', () => {
    expect(parseSettingsForm(ok)).toEqual({
      value: {
        enabled: true,
        gateMode: 'enforce',
        model: 'typesafe/jev-1.14',
        threshold: 0.5,
        timeoutMs: 2500,
        serverShadow: true,
      },
    });
  });

  it.each([
    ['threshold', { threshold: '0.2' }],
    ['threshold', { threshold: '0.96' }],
    ['threshold', { threshold: '' }],
    ['threshold', { threshold: 'abc' }],
    ['timeoutMs', { timeoutMs: '499' }],
    ['timeoutMs', { timeoutMs: '3001' }],
    ['timeoutMs', { timeoutMs: '1500.5' }],
    ['model', { model: 'gpt-4' }],
    ['model', { model: 'typesafe/jev-' }],
  ])('từ chối %s sai: %j', (field, over) => {
    const r = parseSettingsForm({ ...ok, ...over });
    expect('errors' in r && Object.keys(r.errors)).toEqual([field]);
  });

  it('nhận biên 0.3, 0.95, 500, 3000', () => {
    expect('value' in parseSettingsForm({ ...ok, threshold: '0.3', timeoutMs: '500' })).toBe(true);
    expect('value' in parseSettingsForm({ ...ok, threshold: '0.95', timeoutMs: '3000' })).toBe(true);
  });
});
