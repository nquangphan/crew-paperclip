// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useMobileMenu } from '@/app/shell/mobile-menu';
import { AppFrame, SidebarBody, SidebarItem } from '@/ds';
import { initI18n, setLanguage } from '@/i18n';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Where() {
  const { pathname } = useLocation();
  return <p data-testid="where">{pathname}</p>;
}

/** Như CompanyShell: AppFrame điều khiển bằng useMobileMenu, sidebar có link SPA. */
function Shell() {
  const navigate = useNavigate();
  const menu = useMobileMenu();
  return (
    <AppFrame
      mobileTitle="Công ty A"
      menuOpen={menu.open}
      onMenuOpenChange={menu.setOpen}
      sidebar={
        <SidebarBody label="Điều hướng chính">
          <SidebarItem href="/c/docs" label="Docs" onNavigate={() => navigate('/c/docs')} />
          <SidebarItem href="/c/issues" label="Yêu cầu" onNavigate={() => navigate('/c/issues')} />
        </SidebarBody>
      }
    >
      <Where />
    </AppFrame>
  );
}

function mount(path = '/c/issues') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<Shell />} />
      </Routes>
    </MemoryRouter>,
  );
}

// Khi ngăn kéo mở, Radix đặt aria-hidden cho phần còn lại của trang (cả nút ☰).
const trigger = () => screen.getByRole('button', { name: 'Mở menu', hidden: true });
const drawer = () => screen.queryByRole('dialog', { name: 'Menu điều hướng' });

function openDrawer() {
  fireEvent.click(trigger());
  const dialog = drawer();
  expect(dialog).not.toBeNull();
  return dialog as HTMLElement;
}

describe('AppFrame trên màn hẹp', () => {
  it('thanh trên chỉ hiện dưới md, sidebar cố định chỉ hiện từ md', () => {
    mount();
    const topbar = document.querySelector('[data-slot="app-frame-topbar"]');
    expect(topbar?.className).toContain('md:hidden');
    expect(topbar?.textContent).toContain('Công ty A');
    expect(topbar?.contains(trigger())).toBe(true);
    const aside = document.querySelector('[data-slot="app-frame"] > aside');
    expect(aside?.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(aside?.className).toContain('md:flex');
    expect(drawer()).toBeNull();
  });

  it('bấm ☰ mở ngăn kéo chứa nội dung sidebar', () => {
    mount();
    const dialog = openDrawer();
    expect(dialog.getAttribute('data-slot')).toBe('app-frame-drawer');
    expect(dialog.querySelector('nav[aria-label="Điều hướng chính"]')).not.toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('Escape đóng ngăn kéo và trả focus về ☰', async () => {
    mount();
    const dialog = openDrawer();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(drawer()).toBeNull());
    expect(document.activeElement).toBe(trigger());
  });

  it('nút Đóng đóng ngăn kéo', async () => {
    mount();
    const dialog = openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(drawer()).toBeNull());
    expect(dialog.isConnected).toBe(false);
  });

  it('bấm nền mờ đóng ngăn kéo', async () => {
    mount();
    openDrawer();
    const overlay = document.querySelector('[data-slot="sheet-overlay"]');
    expect(overlay).not.toBeNull();
    // Radix gắn bộ nghe pointerdown ngoài hộp thoại sau một nhịp, và với chuột trái thì chờ tới click mới đóng.
    await act(() => new Promise((r) => setTimeout(r, 0)));
    fireEvent.pointerDown(overlay as Element, { button: 0, pointerType: 'mouse' });
    fireEvent.click(overlay as Element);
    await waitFor(() => expect(drawer()).toBeNull());
  });

  it('bấm link trong ngăn kéo: chuyển route rồi tự đóng', async () => {
    mount('/c/issues');
    const dialog = openDrawer();
    fireEvent.click(dialog.querySelector('a[href="/c/docs"]') as Element);
    await waitFor(() => expect(drawer()).toBeNull());
    expect(screen.getByTestId('where').textContent).toBe('/c/docs');
  });

  it('bấm lại link của trang đang mở cũng đóng ngăn kéo', async () => {
    mount('/c/docs');
    const dialog = openDrawer();
    fireEvent.click(dialog.querySelector('a[href="/c/docs"]') as Element);
    await waitFor(() => expect(drawer()).toBeNull());
  });

  it('cửa sổ rộng qua md khi đang mở: tự đóng', async () => {
    let listener: (() => void) | null = null;
    const media = {
      matches: false,
      addEventListener: (_: string, fn: () => void) => {
        listener = fn;
      },
      removeEventListener: () => {
        listener = null;
      },
    };
    vi.stubGlobal('matchMedia', (q: string) => {
      expect(q).toBe('(min-width: 48rem)');
      return media;
    });
    mount();
    openDrawer();
    expect(listener).not.toBeNull();
    media.matches = true;
    act(() => listener?.());
    await waitFor(() => expect(drawer()).toBeNull());
  });

  it('không truyền menuOpen thì AppFrame tự giữ trạng thái', async () => {
    render(
      <AppFrame sidebar={<p>sidebar</p>}>
        <p>nội dung</p>
      </AppFrame>,
    );
    const dialog = openDrawer();
    expect(dialog.textContent).toContain('sidebar');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(drawer()).toBeNull());
  });
});
