// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { StageBadge, StatusBadge } from '@/ds';
import { getI18n, initI18n, setLanguage } from '@/i18n';

beforeAll(async () => {
  await initI18n();
});
afterEach(async () => {
  cleanup();
  await setLanguage('vi');
});

describe('StatusBadge', () => {
  it('nhãn tiếng Việt rồi tiếng Anh khi đổi ngôn ngữ', async () => {
    await setLanguage('vi');
    const { rerender } = render(<StatusBadge status="in_progress" />);
    expect(screen.getByText('Đang làm')).toBeTruthy();
    await setLanguage('en');
    rerender(<StatusBadge status="in_progress" />);
    expect(screen.getByText('In progress')).toBeTruthy();
  });
  it('status lạ hiện nguyên giá trị, không vỡ', () => {
    render(<StatusBadge status="mới_lạ" />);
    expect(screen.getByText('mới_lạ')).toBeTruthy();
  });
  it('phủ mọi status issue, run, agent của Paperclip', async () => {
    const all = [
      'backlog',
      'todo',
      'in_progress',
      'in_review',
      'done',
      'blocked',
      'cancelled',
      'active',
      'paused',
      'idle',
      'running',
      'error',
      'pending_approval',
      'terminated',
      'queued',
      'scheduled_retry',
      'succeeded',
      'interrupted',
      'failed',
      'timed_out',
    ];
    const i18n = getI18n();
    for (const lang of ['vi', 'en']) {
      for (const s of all) expect(i18n.exists(`common:status.${s}`, { lng: lang }), `${lang} ${s}`).toBe(true);
    }
  });
});

describe('StageBadge', () => {
  it('hiện giai đoạn và vòng sửa', () => {
    render(<StageBadge stage="reviewer" round={1} maxRounds={3} />);
    expect(screen.getByText('Reviewer')).toBeTruthy();
    expect(screen.getByText('Vòng sửa 1/3')).toBeTruthy();
  });
});
