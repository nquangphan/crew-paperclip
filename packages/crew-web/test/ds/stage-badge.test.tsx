// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resolveStageKey, StageBadge, StageStrip, stageStripOf } from '@/ds/widgets/stage-badge';
import { initI18n, setLanguage } from '@/i18n';

const at = (position: number, currentType = 'review') => ({ currentType, completed: [], position });

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

describe('resolveStageKey', () => {
  it('gốc code: reviewer, integrator gộp + docs, owner, integrator push', () => {
    expect([0, 1, 2, 3].map((p) => resolveStageKey(at(p), 'code'))).toEqual([
      'reviewer',
      'integratorDocs',
      'owner',
      'integratorPush',
    ]);
  });

  it('gốc code-bf: gộp code + PR, review Bug Finding, owner, merge PR', () => {
    expect([0, 1, 2, 3].map((p) => resolveStageKey(at(p), 'code-bf'))).toEqual([
      'integratorPr',
      'bugFinding',
      'owner',
      'integratorMerge',
    ]);
  });
});

describe('StageBadge', () => {
  it('code-bf ở vị trí 1 ra "Review Bug Finding"; code ở vị trí 1 giữ nhãn integrator gộp + docs', () => {
    render(<StageBadge stage={resolveStageKey(at(1), 'code-bf')} />);
    expect(screen.getByText('Review Bug Finding')).toBeTruthy();
    cleanup();
    render(<StageBadge stage={resolveStageKey(at(1), 'code')} />);
    expect(screen.getByText('Integrator · merge + docs')).toBeTruthy();
  });
});

describe('StageStrip', () => {
  it('dải bốn bước code-bf: bước trước xong, bước hiện tại đánh dấu, bước sau chờ', () => {
    const items = stageStripOf(at(1), 'code-bf');
    expect(items.map((i) => [i.key, i.state])).toEqual([
      ['integratorPr', 'done'],
      ['bugFinding', 'current'],
      ['owner', 'waiting'],
      ['integratorMerge', 'waiting'],
    ]);
    render(
      <StageStrip items={items.map((i) => (i.key === 'bugFinding' ? { ...i, detail: 'Lượt 2 / tối đa 3' } : i))} />,
    );
    const strip = screen.getByRole('list', { name: 'Giai đoạn' });
    const steps = within(strip).getAllByRole('listitem');
    expect(steps.map((s) => s.textContent)).toEqual([
      '1. Gộp code + PRXong',
      '2. Review Bug FindingLượt 2 / tối đa 3',
      '3. Owner duyệtChờ',
      '4. MergeChờ',
    ]);
    expect(steps[1]?.getAttribute('aria-current')).toBe('step');
  });

  it('ticket xong thì mọi bước xong; chưa vào stage nào thì mọi bước chờ', () => {
    expect(
      stageStripOf({ currentType: null, completed: ['s0'], position: null }, 'code-bf').map((i) => i.state),
    ).toEqual(['done', 'done', 'done', 'done']);
    expect(stageStripOf({ currentType: null, completed: [], position: null }, 'code-bf').map((i) => i.state)).toEqual([
      'waiting',
      'waiting',
      'waiting',
      'waiting',
    ]);
  });
});
