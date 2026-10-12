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
  it('chỉ dính đáy từ md trở lên; điện thoại nằm yên cuối luồng để không che nội dung', () => {
    const classes = dockClasses();
    expect(classes).toEqual(expect.arrayContaining(['md:sticky', 'md:bottom-0', 'md:z-10']));
    expect(classes).not.toContain('sticky');
    expect(classes).not.toContain('bottom-0');
  });

  it('đệm đáy chừa vùng an toàn của màn hình', () => {
    expect(dockClasses()).toContain('pb-[max(0.75rem,env(safe-area-inset-bottom))]');
  });
});
