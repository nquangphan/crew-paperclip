import { describe, expect, it } from 'vitest';
import {
  closeIssueHref,
  isNewTabClick,
  issueHref,
  issueNavMode,
  issuePageHref,
  parseIssuePath,
  popupIssueRef,
} from '@/features/issues/popup/issue-href';

describe('hợp đồng URL popup chi tiết `?issue=`', () => {
  it('issueHref giữ trang và tham số đang có, thêm issue', () => {
    expect(issueHref('TPS-2', { pathname: '/TPS/inbox', search: '?tab=all' })).toBe('/TPS/inbox?tab=all&issue=TPS-2');
    expect(issueHref('TPS-2', { pathname: '/TPS/issues', search: '' })).toBe('/TPS/issues?issue=TPS-2');
  });

  it('issueHref thay issue cũ và gắn neo nếu có', () => {
    expect(issueHref('TPS-3', { pathname: '/TPS/search', search: '?q=ab&issue=TPS-2' }, '#comment-c1')).toBe(
      '/TPS/search?q=ab&issue=TPS-3#comment-c1',
    );
  });

  it('closeIssueHref bỏ issue, giữ tham số khác, bỏ neo', () => {
    expect(closeIssueHref({ pathname: '/TPS/inbox', search: '?tab=all&issue=TPS-2' })).toBe('/TPS/inbox?tab=all');
    expect(closeIssueHref({ pathname: '/TPS/issues', search: '?issue=TPS-2' })).toBe('/TPS/issues');
  });

  it('popupIssueRef đọc issue từ search, rỗng thì null', () => {
    expect(popupIssueRef('?tab=all&issue=TPS-2')).toBe('TPS-2');
    expect(popupIssueRef('?issue=')).toBeNull();
    expect(popupIssueRef('')).toBeNull();
  });

  it('issuePageHref là trang đầy đủ của company', () => {
    expect(issuePageHref('TPS', 'TPS-2')).toBe('/TPS/issues/TPS-2');
    expect(issuePageHref('TPS', 'TPS-2', '#document-plan')).toBe('/TPS/issues/TPS-2#document-plan');
  });

  it('parseIssuePath tách mã và neo của đường trang đầy đủ trong company', () => {
    expect(parseIssuePath('/TPS/issues/TPS-2#comment-c1', 'TPS')).toEqual({ identifier: 'TPS-2', hash: '#comment-c1' });
    expect(parseIssuePath('/TPS/issues/TPS-2', 'TPS')).toEqual({ identifier: 'TPS-2', hash: '' });
    expect(parseIssuePath('/CRE/issues/CRE-2', 'TPS')).toBeNull();
    expect(parseIssuePath('/TPS/issues', 'TPS')).toBeNull();
    expect(parseIssuePath('/TPS/projects/x', 'TPS')).toBeNull();
  });

  it('isNewTabClick: Cmd/Ctrl/Shift/Alt hoặc nút không phải chuột trái thì để trình duyệt mở tab', () => {
    const base = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, button: 0 };
    expect(isNewTabClick(base)).toBe(false);
    expect(isNewTabClick({ ...base, metaKey: true })).toBe(true);
    expect(isNewTabClick({ ...base, ctrlKey: true })).toBe(true);
    expect(isNewTabClick({ ...base, shiftKey: true })).toBe(true);
    expect(isNewTabClick({ ...base, altKey: true })).toBe(true);
    expect(isNewTabClick({ ...base, button: 1 })).toBe(true);
  });

  it('issueNavMode: có ?issue= là popup, trang đầy đủ là page, còn lại là outside', () => {
    expect(issueNavMode({ pathname: '/TPS/inbox', search: '?issue=TPS-2' }, 'TPS')).toBe('popup');
    expect(issueNavMode({ pathname: '/TPS/issues/TPS-2', search: '?issue=TPS-3' }, 'TPS')).toBe('popup');
    expect(issueNavMode({ pathname: '/TPS/issues/TPS-2', search: '' }, 'TPS')).toBe('page');
    expect(issueNavMode({ pathname: '/TPS/issues', search: '?status=todo' }, 'TPS')).toBe('outside');
    expect(issueNavMode({ pathname: '/TPS/runs/r1', search: '' }, 'TPS')).toBe('outside');
  });
});
