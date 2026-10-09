import { warnForAttachment } from '@crew/paperclip-plugin/shared/attachment-rules';
import { buildDocsTree } from '@crew/paperclip-plugin/shared/docs-tree';
import { appLine } from '@crew/paperclip-plugin/shared/machine-card';
import { layoutHierarchy, projectCrewMap } from '@crew/paperclip-plugin/shared/map';
import { describe, expect, it } from 'vitest';
import type { CrewMap } from '@/api/crew/types';
import fixture from '../ds/crew/__fixtures__/map.json';

describe('import logic dùng chung từ plugin', () => {
  it('map: chiếu và bố cục khớp số node, bỏ cạnh thiếu issue', () => {
    const projection = projectCrewMap(fixture as unknown as CrewMap);
    expect(projection.nodes).toHaveLength(5);
    expect(projection.edges.some((e) => e.target === 'i-ghost')).toBe(false);
    expect(Object.keys(layoutHierarchy(projection))).toHaveLength(5);
  });
  it('docs-tree, attachment-rules, machine-card', () => {
    expect(buildDocsTree([{ path: 'docs/a.md', title: 'A' }])).toHaveLength(1);
    expect(typeof warnForAttachment).toBe('function');
    expect(typeof appLine).toBe('function');
  });
});
