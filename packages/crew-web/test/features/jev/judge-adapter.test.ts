import { describe, expect, it } from 'vitest';
import {
  complexityFlagFor,
  parseApprovalNote,
  parseAttention,
  parseComplexityFlag,
  parseJudgmentStats,
  parseJudgments,
  parseRequestType,
  sumFeatureStats,
} from '@/features/jev/judge-adapter';

describe('parseApprovalNote', () => {
  it('nhận kết quả đúng dạng, chuẩn hóa judgmentId số thành chuỗi', () => {
    expect(
      parseApprovalNote({ ok: true, mode: 'on', label: 'approve', confidence: 0.9, mismatch: true, judgmentId: 12 }),
    ).toEqual({ mode: 'on', label: 'approve', confidence: 0.9, mismatch: true, judgmentId: '12' });
  });

  it('shadow: label null vẫn hợp lệ (server trả ngay)', () => {
    expect(
      parseApprovalNote({ ok: true, mode: 'shadow', label: null, confidence: null, mismatch: false, judgmentId: null }),
    ).toEqual({
      mode: 'shadow',
      label: null,
      confidence: null,
      mismatch: false,
      judgmentId: null,
    });
  });

  it.each([
    ['ok:false', { ok: false, reason: 'off' }],
    ['thiếu ok', { mode: 'on', label: 'approve', mismatch: true }],
    ['mode lạ', { ok: true, mode: 'maybe', label: 'approve', mismatch: true }],
    ['label lạ', { ok: true, mode: 'on', label: 'vui', mismatch: true }],
    ['mismatch không phải boolean', { ok: true, mode: 'on', label: 'approve', mismatch: 'có' }],
    ['null', null],
    ['chuỗi', 'ok'],
    ['mảng', []],
  ])('%s: null', (_n, raw) => {
    expect(parseApprovalNote(raw)).toBeNull();
  });
});

describe('parseRequestType', () => {
  it('nhận kết quả đúng dạng', () => {
    expect(parseRequestType({ ok: true, mode: 'on', label: 'docs', confidence: 0.7, judgmentId: '3' })).toEqual({
      mode: 'on',
      label: 'docs',
      confidence: 0.7,
      judgmentId: '3',
    });
  });
  it.each([
    [{ ok: false, reason: 'unsure' }],
    [{ ok: true, mode: 'on', label: 'poetry' }],
    [{ ok: true, label: 'code' }],
    [undefined],
  ])('sai dạng %#: null', (raw) => {
    expect(parseRequestType(raw)).toBeNull();
  });
});

describe('thống kê và ca lệch', () => {
  const row = {
    feature: 'approval_note',
    mode: 'on',
    total: 10,
    mismatch: 2,
    escalated: 1,
    error: 3,
    p50Ms: 400,
    p95Ms: 900,
  };

  it('đọc {days, rows} của server (error số ít) và bỏ dòng sai dạng', () => {
    expect(parseJudgmentStats({ days: 7, rows: [row, { feature: 'lạ', mode: 'on' }, 'x', null] })).toEqual([
      { feature: 'approval_note', mode: 'on', total: 10, mismatch: 2, escalated: 1, errors: 3, p50Ms: 400, p95Ms: 900 },
    ]);
  });

  it('không phải danh sách thì rỗng', () => {
    expect(parseJudgmentStats(null)).toEqual([]);
    expect(parseJudgmentStats({ rows: 'x' })).toEqual([]);
    expect(parseJudgmentStats('boom')).toEqual([]);
  });

  it('gộp shadow + on của một tính năng', () => {
    const rows = parseJudgmentStats({
      rows: [row, { ...row, mode: 'shadow', total: 5, mismatch: 1, escalated: 0, error: 0, p50Ms: 300, p95Ms: 1200 }],
    });
    expect(sumFeatureStats(rows, 'approval_note')).toMatchObject({
      total: 15,
      mismatch: 3,
      escalated: 1,
      errors: 3,
      p50Ms: 400,
      p95Ms: 1200,
    });
    expect(sumFeatureStats(rows, 'complexity')).toBeNull();
  });

  it('parseJudgments đọc items, bỏ dòng thiếu id/ngày/feature', () => {
    const ok = {
      id: '5',
      feature: 'complexity',
      mode: 'on',
      createdAt: '2026-10-22T03:30:00.000Z',
      mismatch: true,
      baseline: 'small',
      jevLabel: 'yes',
      confidence: 0.8,
      inputExcerpt: 'migration',
    };
    const rows = parseJudgments({
      items: [ok, { ...ok, id: undefined }, { ...ok, feature: 'x' }, { ...ok, createdAt: null }],
      nextBefore: null,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: '5',
      baseline: 'small',
      jevLabel: 'yes',
      mismatch: true,
      shown: false,
      ownerOutcome: null,
    });
  });
});

describe('cờ complexity', () => {
  it('kind jev và vision đều hiện; thiếu hay sai dạng thì không', () => {
    expect(
      parseComplexityFlag({ kind: 'jev', jevSaysLarge: true, declared: 'small', reason: 'chạm migration' }),
    ).toEqual({
      kind: 'jev',
      jevSaysLarge: true,
      declared: 'small',
      reason: 'chạm migration',
    });
    expect(
      parseComplexityFlag({ kind: 'vision', jevSaysLarge: false, declared: 'small', reason: 'có ảnh' })?.kind,
    ).toBe('vision');
    expect(parseComplexityFlag(null)).toBeNull();
    expect(parseComplexityFlag({ kind: 'lạ' })).toBeNull();
    expect(parseComplexityFlag('x')).toBeNull();
  });

  it('lấy cờ theo issue từ bản đồ, không phân biệt hoa thường', () => {
    const map = { complexityFlags: { 'aaaa-1': { kind: 'jev', jevSaysLarge: true, declared: 'small', reason: 'r' } } };
    expect(complexityFlagFor(map, 'AAAA-1')?.reason).toBe('r');
    expect(complexityFlagFor(map, 'bbbb')).toBeNull();
    expect(complexityFlagFor({ complexityFlags: 5 }, 'aaaa-1')).toBeNull();
    expect(complexityFlagFor(undefined, 'aaaa-1')).toBeNull();
  });
});

describe('parseAttention', () => {
  it('đọc items, chuẩn hóa id về chữ thường, bỏ lý do sai dạng và issue không còn lý do', () => {
    const map = parseAttention({
      enabled: true,
      mode: 'on',
      items: [
        {
          issueId: 'AAA',
          reasons: [{ kind: 'owner_decision', text: 'Có câu hỏi' }, { kind: 'lạ', text: 'x' }, { kind: 'risky_paths' }],
        },
        { issueId: 'bbb', reasons: [{ kind: 'lạ', text: 'x' }] },
        { reasons: [] },
        'x',
      ],
    });
    expect([...map.keys()]).toEqual(['aaa']);
    expect(map.get('aaa')).toEqual([{ kind: 'owner_decision', text: 'Có câu hỏi' }]);
  });
  it('sai dạng thì rỗng', () => {
    expect(parseAttention(null).size).toBe(0);
    expect(parseAttention({ items: 'x' }).size).toBe(0);
    expect(parseAttention('boom').size).toBe(0);
  });
});
