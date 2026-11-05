import { describe, expect, it } from 'vitest';
import { docHref, focusHref, legacyHref, parseRoadmapParams, viewHref } from '@/features/roadmap/roadmap-url';

const at = (search: string) => ({ pathname: '/TPS/roadmap', search });

describe('parseRoadmapParams', () => {
  it('mặc định toàn cảnh, dạng bản đồ', () => {
    expect(parseRoadmapParams('')).toEqual({ focus: null, doc: null, view: 'map' });
  });

  it('focus là mã việc, project:<id>, docs:<project>, dir:<project>:<thư mục>', () => {
    expect(parseRoadmapParams('?focus=TPS-697').focus).toBe('TPS-697');
    expect(parseRoadmapParams('?focus=project:p1').focus).toBe('project:p1');
    expect(parseRoadmapParams('?focus=%20docs:p1%20').focus).toBe('docs:p1');
    expect(parseRoadmapParams('?focus=').focus).toBeNull();
  });

  it('trang docs: bỏ đường có ".." và "/" thừa', () => {
    expect(parseRoadmapParams('?focus=docs:p1&doc=/docs/a.md/').doc).toBe('docs/a.md');
    expect(parseRoadmapParams('?focus=docs:p1&doc=a/../../b').doc).toBeNull();
  });

  it('view=list', () => {
    expect(parseRoadmapParams('?view=list').view).toBe('list');
    expect(parseRoadmapParams('?view=lạ').view).toBe('map');
  });
});

describe('focusHref: mỗi lần lấy nét là một mục lịch sử mới', () => {
  it('đặt focus, giữ view, bỏ popup issue và doc', () => {
    expect(focusHref(at('?view=list&issue=TPS-9&doc=a.md'), 'TPS-12')).toBe('/TPS/roadmap?view=list&focus=TPS-12');
  });
  it('null là toàn cảnh', () => {
    expect(focusHref(at('?focus=TPS-12'), null)).toBe('/TPS/roadmap');
  });
  it('bỏ luôn tham số cũ nếu còn sót', () => {
    expect(focusHref(at('?project=p1&request=TPS-1'), 'project:p1')).toBe('/TPS/roadmap?focus=project%3Ap1');
  });
});

describe('legacyHref: link cũ ?project= / ?request= tự đổi sang ?focus=', () => {
  it('không có tham số cũ thì null', () => {
    expect(legacyHref(at('?focus=TPS-1'))).toBeNull();
    expect(legacyHref(at(''))).toBeNull();
  });
  it('?project= → focus project', () => {
    expect(legacyHref(at('?project=p1'))).toBe('/TPS/roadmap?focus=project%3Ap1');
    expect(legacyHref(at('?project=none'))).toBe('/TPS/roadmap?focus=project%3Anone');
  });
  it('?project=&request= → focus mã yêu cầu, giữ view và popup issue', () => {
    expect(legacyHref(at('?project=p1&request=TPS-12&view=list&issue=TPS-13'))).toBe(
      '/TPS/roadmap?view=list&issue=TPS-13&focus=TPS-12',
    );
  });
  it('nhánh docs: docs=1, folder, doc', () => {
    expect(legacyHref(at('?project=p1&docs=1'))).toBe('/TPS/roadmap?focus=docs%3Ap1');
    expect(legacyHref(at('?project=p1&docs=1&folder=docs/flows&doc=docs/flows/a.md'))).toBe(
      '/TPS/roadmap?focus=dir%3Ap1%3Adocs%2Fflows&doc=docs%2Fflows%2Fa.md',
    );
  });
  it('request thiếu project vẫn mở đúng yêu cầu', () => {
    expect(legacyHref(at('?request=TPS-12'))).toBe('/TPS/roadmap?focus=TPS-12');
  });
});

describe('viewHref, docHref', () => {
  it('đổi dạng giữ focus', () => {
    expect(viewHref(at('?focus=TPS-1'), 'list')).toBe('/TPS/roadmap?focus=TPS-1&view=list');
    expect(viewHref(at('?focus=TPS-1&view=list'), 'map')).toBe('/TPS/roadmap?focus=TPS-1');
  });
  it('mở/đóng popup trang docs giữ focus', () => {
    expect(docHref(at('?focus=docs:p1'), 'a.md')).toBe('/TPS/roadmap?focus=docs%3Ap1&doc=a.md');
    expect(docHref(at('?focus=docs:p1&doc=a.md'), null)).toBe('/TPS/roadmap?focus=docs%3Ap1');
  });
});
