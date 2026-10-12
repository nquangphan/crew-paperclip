import { describe, expect, it } from 'vitest';
import {
  docHref,
  levelDepth,
  levelKeyOf,
  parentTarget,
  parseRoadmapParams,
  roadmapHref,
  viewHref,
} from '@/features/roadmap/roadmap-url';

const at = (search: string) => ({ pathname: '/TPS/roadmap', search });

describe('parseRoadmapParams', () => {
  it('mặc định tầng công ty, dạng bản đồ', () => {
    expect(parseRoadmapParams('')).toEqual({
      project: null,
      request: null,
      docs: false,
      folder: null,
      doc: null,
      view: 'map',
    });
  });

  it('request chỉ có nghĩa khi có project; docs không đi cùng request', () => {
    expect(parseRoadmapParams('?request=TPS-1').request).toBeNull();
    const p = parseRoadmapParams('?project=p1&request=TPS-1&docs=1&folder=a');
    expect(p).toMatchObject({ project: 'p1', request: 'TPS-1', docs: false, folder: null });
  });

  it('nhánh docs: thư mục và trang; bỏ đường có ".." và "/" thừa', () => {
    expect(parseRoadmapParams('?project=p1&docs=1&folder=/docs/flows/&doc=docs/a.md')).toMatchObject({
      docs: true,
      folder: 'docs/flows',
      doc: 'docs/a.md',
    });
    expect(parseRoadmapParams('?project=p1&docs=1&folder=../x&doc=a/../../b').folder).toBeNull();
    expect(parseRoadmapParams('?project=p1&docs=1&doc=a/../../b').doc).toBeNull();
    expect(parseRoadmapParams('?project=p1&folder=docs').folder).toBeNull();
  });

  it('view=list', () => {
    expect(parseRoadmapParams('?view=list').view).toBe('list');
    expect(parseRoadmapParams('?view=lạ').view).toBe('map');
  });
});

describe('roadmapHref', () => {
  it('giữ view, bỏ popup issue và doc khi đổi tầng', () => {
    expect(roadmapHref(at('?view=list&issue=TPS-3&project=p0'), { project: 'p1' })).toBe(
      '/TPS/roadmap?view=list&project=p1',
    );
    expect(roadmapHref(at('?project=p1&docs=1&doc=a.md'), { project: 'p1', docs: true, folder: 'docs' })).toBe(
      '/TPS/roadmap?project=p1&docs=1&folder=docs',
    );
  });

  it('về tầng công ty thì bỏ hết tham số tầng', () => {
    expect(roadmapHref(at('?project=p1&request=TPS-1'), {})).toBe('/TPS/roadmap');
  });

  it('tầng yêu cầu', () => {
    expect(roadmapHref(at(''), { project: 'p1', request: 'TPS-1' })).toBe('/TPS/roadmap?project=p1&request=TPS-1');
  });
});

describe('viewHref và docHref', () => {
  it('đổi dạng giữ tầng', () => {
    expect(viewHref(at('?project=p1'), 'list')).toBe('/TPS/roadmap?project=p1&view=list');
    expect(viewHref(at('?project=p1&view=list'), 'map')).toBe('/TPS/roadmap?project=p1');
  });
  it('mở và đóng popup trang docs', () => {
    expect(docHref(at('?project=p1&docs=1'), 'README.md')).toBe('/TPS/roadmap?project=p1&docs=1&doc=README.md');
    expect(docHref(at('?project=p1&docs=1&doc=README.md'), null)).toBe('/TPS/roadmap?project=p1&docs=1');
  });
});

describe('parentTarget, levelDepth, levelKeyOf', () => {
  const p = (search: string) => parseRoadmapParams(search);

  it('lùi một tầng', () => {
    expect(parentTarget(p(''))).toBeNull();
    expect(parentTarget(p('?project=p1'))).toEqual({});
    expect(parentTarget(p('?project=p1&request=TPS-1'))).toEqual({ project: 'p1' });
    expect(parentTarget(p('?project=p1&docs=1'))).toEqual({ project: 'p1' });
    expect(parentTarget(p('?project=p1&docs=1&folder=a'))).toEqual({ project: 'p1', docs: true, folder: null });
    expect(parentTarget(p('?project=p1&docs=1&folder=a/b'))).toEqual({ project: 'p1', docs: true, folder: 'a' });
  });

  it('độ sâu và khóa tầng', () => {
    expect([
      levelDepth(p('')),
      levelDepth(p('?project=p1')),
      levelDepth(p('?project=p1&request=TPS-1')),
      levelDepth(p('?project=p1&docs=1')),
      levelDepth(p('?project=p1&docs=1&folder=a/b')),
    ]).toEqual([0, 1, 2, 2, 4]);
    expect(levelKeyOf(p('?project=p1&docs=1&folder=a'))).not.toBe(levelKeyOf(p('?project=p1&docs=1')));
    // Đổi dạng hay mở popup không đổi tầng.
    expect(levelKeyOf(p('?project=p1&view=list&issue=TPS-2'))).toBe(levelKeyOf(p('?project=p1')));
  });
});
