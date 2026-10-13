// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ComposerDock } from '@/ds';

afterEach(cleanup);

const dockClasses = (): string[] => {
  render(
    <ComposerDock>
      <textarea aria-label="Bình luận" />
    </ComposerDock>,
  );
  const dock = screen.getByLabelText('Bình luận').closest('[data-slot="composer-dock"]');
  if (!dock) throw new Error('thiếu composer-dock');
  return dock.className.split(/\s+/);
};

describe('ComposerDock', () => {
  it('không dính ở cỡ màn hình nào: ô soạn nằm trên luồng mới nhất trước, dính sẽ che nội dung', () => {
    const classes = dockClasses();
    expect(classes.some((c) => /(^|:)sticky$/.test(c))).toBe(false);
    expect(classes.some((c) => /(^|:)(bottom|top)-/.test(c))).toBe(false);
  });

  it('khung bo tròn quanh ô soạn', () => {
    render(
      <ComposerDock>
        <textarea aria-label="Soạn" />
      </ComposerDock>,
    );
    expect(screen.getByLabelText('Soạn').parentElement?.className).toContain('rounded-2xl');
  });
});
