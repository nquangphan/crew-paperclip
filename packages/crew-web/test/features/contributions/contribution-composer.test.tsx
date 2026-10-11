// @vitest-environment jsdom
import type { Issue } from '@paperclipai/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Composer } from '@/features/issues/detail/composer';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer } from '../../app/fetch-mock';
import { ISSUE, wrap } from '../issues/detail-fixtures';
import { contribution, GUEST_ACCESS } from './fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const issue = ISSUE as unknown as Issue;

describe('ô soạn theo vai trò', () => {
  it('khách góp ý gửi bình luận chờ duyệt, không gọi route bình luận stock', async () => {
    const { calls } = mockServer({
      ...accessRoute('c1', GUEST_ACCESS),
      'POST /api/crew/companies/c1/contributions': { status: 201, body: contribution({}) },
    });
    render(wrap(<Composer issue={issue} />));
    const box = (await screen.findByLabelText('Viết góp ý')) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '  Nên đổi màu nút  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi để owner duyệt' }));
    await screen.findByRole('button', { name: 'Gửi để owner duyệt' });
    await Promise.resolve();
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('/api/crew/companies/c1/contributions');
    // Gửi nguyên văn khách viết (chỉ trim để kiểm rỗng).
    expect(post?.body).toEqual({ kind: 'comment', issueId: 'i1', body: '  Nên đổi màu nút  ' });
    expect(calls.some((c) => c.url.includes('/api/issues/i1/comments') && c.method === 'POST')).toBe(false);
    await screen.findByDisplayValue('');
  });

  it('owner vẫn dùng ô soạn stock', async () => {
    mockServer({});
    render(wrap(<Composer issue={issue} />));
    expect(await screen.findByLabelText('Viết bình luận')).toBeTruthy();
    expect(screen.queryByLabelText('Viết góp ý')).toBeNull();
  });
});
