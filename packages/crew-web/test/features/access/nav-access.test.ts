import { describe, expect, it } from 'vitest';
import { navItemVisible, navLabelKey, routeAllowed, routeNeedsAccess } from '@/features/access';

const owner = { isOwner: true, isContributor: false, readOnly: false, loading: false };
const contributor = { isOwner: false, isContributor: true, readOnly: true, loading: false };
const viewer = { isOwner: false, isContributor: false, readOnly: true, loading: false };
const operator = { isOwner: false, isContributor: false, readOnly: false, loading: false };
const loading = { isOwner: false, isContributor: false, readOnly: true, loading: true };

describe('navItemVisible', () => {
  it('owner thấy Thành viên và Chờ duyệt, cùng mọi mục thường', () => {
    for (const id of ['members', 'contributions', 'inbox', 'agents', 'skills', 'machines', 'newIssue'] as const) {
      expect(navItemVisible(id, owner), id).toBe(true);
    }
  });

  it('khách góp ý bỏ Hộp thư, Agent, Skill, Máy, Thành viên; giữ Góp ý và Yêu cầu mới', () => {
    for (const id of ['inbox', 'agents', 'skills', 'machines', 'members'] as const) {
      expect(navItemVisible(id, contributor), id).toBe(false);
    }
    for (const id of ['contributions', 'newIssue', 'issues', 'projects', 'dashboard', 'search'] as const) {
      expect(navItemVisible(id, contributor), id).toBe(true);
    }
  });

  it('viewer thuần cũng không có Góp ý và Yêu cầu mới', () => {
    expect(navItemVisible('contributions', viewer)).toBe(false);
    expect(navItemVisible('newIssue', viewer)).toBe(false);
    expect(navItemVisible('inbox', viewer)).toBe(false);
  });

  it('operator không thấy Thành viên và Góp ý', () => {
    expect(navItemVisible('members', operator)).toBe(false);
    expect(navItemVisible('contributions', operator)).toBe(false);
    expect(navItemVisible('inbox', operator)).toBe(true);
  });

  it('đang tải: chưa ẩn mục thường (owner không chớp), chưa hiện mục theo vai trò', () => {
    expect(navItemVisible('inbox', loading)).toBe(true);
    expect(navItemVisible('members', loading)).toBe(false);
    expect(navItemVisible('contributions', loading)).toBe(false);
  });
});

describe('navLabelKey', () => {
  it('owner: Chờ duyệt; khách: Góp ý của tôi', () => {
    expect(navLabelKey('contributions', owner)).toBe('nav.contributions');
    expect(navLabelKey('contributions', contributor)).toBe('nav.contributionsMine');
    expect(navLabelKey('inbox', contributor)).toBe('nav.inbox');
  });
});

describe('routeAllowed', () => {
  it('viewer không vào được trang agent, run, hộp thư, skill, máy, wizard, chi phí, hoạt động', () => {
    for (const first of ['inbox', 'agents', 'skills', 'machines', 'wizards', 'runs', 'costs', 'activity']) {
      expect(routeAllowed([first], contributor), first).toBe(false);
      expect(routeAllowed([first, 'x1'], viewer), first).toBe(false);
      expect(routeAllowed([first], owner), first).toBe(true);
    }
  });

  it('viewer không vào wizard project nhưng xem được project', () => {
    expect(routeAllowed(['projects', 'new'], contributor)).toBe(false);
    expect(routeAllowed(['projects', 'remove'], contributor)).toBe(false);
    expect(routeAllowed(['projects'], contributor)).toBe(true);
    expect(routeAllowed(['projects', 'alpha'], contributor)).toBe(true);
    expect(routeAllowed(['issues'], contributor)).toBe(true);
  });

  it('Thành viên chỉ owner; Góp ý owner và khách', () => {
    expect(routeAllowed(['members'], owner)).toBe(true);
    expect(routeAllowed(['members'], contributor)).toBe(false);
    expect(routeAllowed(['members'], operator)).toBe(false);
    expect(routeAllowed(['contributions'], contributor)).toBe(true);
    expect(routeAllowed(['contributions'], owner)).toBe(true);
    expect(routeAllowed(['contributions'], viewer)).toBe(false);
  });

  it('chỉ trang phụ thuộc vai trò mới phải đợi tải xong vai trò', () => {
    expect(routeNeedsAccess(['inbox'])).toBe(true);
    expect(routeNeedsAccess(['members'])).toBe(true);
    expect(routeNeedsAccess(['projects', 'new'])).toBe(true);
    expect(routeNeedsAccess(['issues'])).toBe(false);
    expect(routeNeedsAccess(['projects', 'alpha'])).toBe(false);
  });
});
