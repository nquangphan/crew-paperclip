import i18next, { type i18n, type Resource } from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import type { Lang } from './format';

export type { Lang } from './format';
export { formatDateTime, formatRelative, formatUsd } from './format';

const STORAGE_KEY = 'crew.lang';

// Chuỗi chung ở ./locales (namespace common); chuỗi từng feature ở features/<tên>/locales (namespace = tên feature).
const common = import.meta.glob('./locales/*.json', { eager: true, import: 'default' });
const features = import.meta.glob('../features/*/locales/*.json', { eager: true, import: 'default' });

const langOf = (path: string): Lang => (path.endsWith('/en.json') ? 'en' : 'vi');

export function buildResources(): Resource {
  const res: Record<Lang, Record<string, unknown>> = { vi: {}, en: {} };
  for (const [path, data] of Object.entries(common)) res[langOf(path)].common = data;
  for (const [path, data] of Object.entries(features)) res[langOf(path)][path.split('/')[2]] = data;
  return res as Resource;
}

export function readLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'vi' || v === 'en' ? v : 'vi';
  } catch {
    return 'vi';
  }
}

let ready: Promise<i18n> | null = null;

export function initI18n(): Promise<i18n> {
  ready ??= i18next
    .use(initReactI18next)
    .init({
      resources: buildResources(),
      lng: readLang(),
      fallbackLng: 'vi',
      defaultNS: 'common',
      interpolation: { escapeValue: false },
    })
    .then(() => i18next);
  return ready;
}

export const getI18n = (): i18n => i18next;

export async function setLanguage(lang: Lang): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // trình duyệt chặn lưu trữ: vẫn đổi ngôn ngữ cho phiên này
  }
  await i18next.changeLanguage(lang);
}

/** Hook dịch; không truyền ns thì dùng namespace common. */
export function useT(ns?: string) {
  const { t, i18n: inst } = useTranslation(ns ?? 'common');
  return { t, lang: (inst.language === 'en' ? 'en' : 'vi') as Lang };
}
