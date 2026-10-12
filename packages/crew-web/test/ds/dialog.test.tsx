// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ds';
import { initI18n, setLanguage } from '@/i18n';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

function LongDialog({ className }: { className?: string }) {
  return (
    <Dialog open>
      <DialogContent className={className}>
        <DialogHeader>
          <DialogTitle>Yêu cầu mới</DialogTitle>
          <DialogDescription>Mô tả</DialogDescription>
        </DialogHeader>
        <p>{'Dòng mô tả rất dài\n'.repeat(500)}</p>
        <DialogFooter>
          <Button>Tạo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe('Dialog', () => {
  // jsdom không tính bố cục, nên kiểm hợp đồng class: khung không cao quá khung nhìn và tự cuộn, chân dính đáy.
  it('nội dung dài cuộn bên trong khung, không tràn khung nhìn', () => {
    render(<LongDialog />);
    const content = screen.getByRole('dialog', { name: 'Yêu cầu mới' });
    expect(content.className).toContain('max-h-(--sz-dialog-max-h)');
    expect(content.className).toContain('overflow-y-auto');
  });

  it('chân dialog dính đáy khung cuộn và có nền che chữ cuộn phía sau', () => {
    render(<LongDialog />);
    const footer = screen.getByRole('button', { name: 'Tạo' }).closest('[data-slot="dialog-footer"]');
    expect(footer?.className).toContain('sticky');
    expect(footer?.className).toContain('-bottom-6');
    expect(footer?.className).toContain('bg-background');
  });

  it('token chiều cao tối đa trừ khoảng hở và vùng an toàn trên, dưới theo dvh', () => {
    const css = readFileSync('src/ds/tokens.css', 'utf8');
    expect(css).toMatch(
      /--sz-dialog-max-h: calc\(100dvh - max\(1rem, env\(safe-area-inset-top\)\) - max\(1rem, env\(safe-area-inset-bottom\)\)\);/,
    );
  });

  it('dialog tự đặt chiều cao (popup chi tiết) vẫn ghi đè được giới hạn mặc định', () => {
    render(<LongDialog className="h-[92vh] max-h-[92vh]" />);
    const content = screen.getByRole('dialog', { name: 'Yêu cầu mới' });
    expect(content.className).toContain('max-h-[92vh]');
    expect(content.className).not.toContain('max-h-(--sz-dialog-max-h)');
  });
});
