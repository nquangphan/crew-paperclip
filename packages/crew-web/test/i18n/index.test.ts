// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { buildResources, initI18n, readLang, setLanguage } from '@/i18n';

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {}
});

describe('i18n', () => {
  it('buildResources gom locale chung vào namespace common', () => {
    const res = buildResources() as Record<string, Record<string, Record<string, unknown>>>;
    expect(res.vi.common.action).toBeTruthy();
    expect(res.en.common.action).toBeTruthy();
  });
  it('readLang mặc định vi, chỉ nhận vi|en', () => {
    expect(readLang()).toBe('vi');
    localStorage.setItem('crew.lang', 'fr');
    expect(readLang()).toBe('vi');
    localStorage.setItem('crew.lang', 'en');
    expect(readLang()).toBe('en');
  });
  it('setLanguage ghi localStorage và đổi ngôn ngữ', async () => {
    const i18n = await initI18n();
    await setLanguage('en');
    expect(localStorage.getItem('crew.lang')).toBe('en');
    expect(i18n.t('common:status.done')).toBe('Done');
    await setLanguage('vi');
    expect(i18n.t('common:status.done')).toBe('Hoàn thành');
  });
});
