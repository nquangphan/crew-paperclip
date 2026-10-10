import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BA_MISSING_ROWS, MISSING_FEATURES, MISSING_GROUPS, MISSING_REASONS } from '@/features/guide/missing-features';

const load = (lang: 'vi' | 'en') =>
  JSON.parse(readFileSync(`src/features/guide/locales/${lang}.json`, 'utf8')) as {
    missing: Record<string, { feature: string; where: string; note: string }>;
    groups: Record<string, string>;
    reasons: Record<string, { label: string; meaning: string }>;
  };

describe('MISSING_FEATURES (BA mục 2)', () => {
  it('đủ số dòng của BA mục 2 trừ hai dòng đã có luồng (gỡ agent, gỡ project)', () => {
    expect(BA_MISSING_ROWS).toBe(51);
    expect(MISSING_FEATURES).toHaveLength(BA_MISSING_ROWS);
  });
  it('số dòng theo nhóm khớp 5 bảng của BA', () => {
    const count = (g: string) => MISSING_FEATURES.filter((f) => f.group === g).length;
    expect(MISSING_GROUPS.map(count)).toEqual([13, 12, 13, 4, 9]);
    expect(MISSING_GROUPS).toEqual(['nav', 'issue', 'agent', 'project', 'company']);
  });
  it('id không trùng và chỉ dùng mã lý do KD/HK/CL/RS', () => {
    const ids = MISSING_FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of MISSING_FEATURES) expect(MISSING_REASONS).toContain(f.reason);
  });
  it('mọi id có đủ feature, where, note ở cả vi và en', () => {
    for (const lang of ['vi', 'en'] as const) {
      const { missing } = load(lang);
      expect(Object.keys(missing).sort()).toEqual(MISSING_FEATURES.map((f) => f.id).sort());
      for (const f of MISSING_FEATURES) {
        for (const key of ['feature', 'where', 'note'] as const) {
          expect(missing[f.id][key].trim().length, `${lang}.${f.id}.${key}`).toBeGreaterThan(0);
        }
      }
    }
  });
  it('mọi nhóm và mọi mã lý do có nhãn ở cả vi và en', () => {
    for (const lang of ['vi', 'en'] as const) {
      const data = load(lang);
      for (const g of MISSING_GROUPS) expect(data.groups[g]).toBeTruthy();
      for (const r of MISSING_REASONS) expect(data.reasons[r].label && data.reasons[r].meaning).toBeTruthy();
    }
  });
  it('tính năng đã làm không còn trong bảng "không có": gỡ agent, gỡ project', () => {
    const ids = MISSING_FEATURES.map((f) => f.id);
    expect(ids).not.toContain('terminateAgent');
    expect(ids).not.toContain('archiveProject');
  });
  it('chữ không còn khẳng định thiếu nút đã làm (Ép Done, sửa/xóa skill, gỡ agent/project)', () => {
    for (const lang of ['vi', 'en'] as const) {
      const { missing } = load(lang);
      const text = JSON.stringify([missing.freeStatus, missing.skillStudio]);
      expect(text, lang).toMatch(/Ép Done|Force Done/);
      expect(missing.skillStudio.note, lang).not.toMatch(/chỉ có|only lists/);
    }
  });
  it('luật bảo mật mới được nói rõ: agent không tạo agent, quyền không sửa trên web', () => {
    const vi = load('vi').missing;
    expect(MISSING_FEATURES.find((f) => f.id === 'agentPermissions')?.reason).toBe('HK');
    expect(vi.agentPermissions.note).toMatch(/tạo agent/);
  });
});
