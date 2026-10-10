// S0.1: sidebar. Mục chỉ hiện khi feature đã có route (không link chết). Badge Hộp thư = sidebar-badges + issue chưa đọc.
import type { ComponentType } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Kbd, Logo, SidebarBody, SidebarFooter, SidebarHeader, SidebarItem } from '@/ds';
import {
  BookOpen,
  Bot,
  FileText,
  Folder,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Monitor,
  Plus,
  Search,
  Settings,
  Sparkles,
} from '@/ds/icons';
import { useInboxBadge } from '@/features/inbox/use-inbox-badge';
import { useT } from '@/i18n';
import { useCompany } from '../hooks';
import { companyPath, NAV_ITEMS, type NavId } from '../routes-util';
import { AccountMenu } from './account-menu';
import { CompanySwitcher } from './company-switcher';
import { LanguageSwitch } from './language-switch';
import { StockUiSidebarItem } from './stock-ui-link';

/** Ký hiệu phím tắt, không phải chữ cần dịch. */
const PALETTE_SHORTCUT = '⌘K';

const ICONS: Record<NavId, ComponentType<{ 'aria-hidden'?: boolean }>> = {
  newIssue: Plus,
  search: Search,
  dashboard: LayoutDashboard,
  inbox: Inbox,
  issues: ListChecks,
  projects: Folder,
  agents: Bot,
  skills: Sparkles,
  machines: Monitor,
  docs: FileText,
  guide: BookOpen,
  settings: Settings,
};

export function Sidebar({ segments, onOpenPalette }: { segments: ReadonlySet<string>; onOpenPalette: () => void }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { company } = useCompany();
  const inboxBadge = useInboxBadge(company.id, segments.has('inbox'));
  const items = NAV_ITEMS.filter((i) => segments.has(i.segment));
  const isActive = (to: string) => {
    if (to.includes('?')) return `${pathname}${search}` === companyPath(company.issuePrefix, to);
    const base = companyPath(company.issuePrefix, to);
    return (pathname === base || pathname.startsWith(`${base}/`)) && !search.includes('new=1');
  };

  return (
    <>
      <SidebarHeader>
        <Logo />
        <CompanySwitcher />
        <Button variant="outline" size="sm" onClick={onOpenPalette}>
          <Search aria-hidden />
          <span className="min-w-0 flex-1 truncate">{t('nav.quickSearch')}</span>
          <Kbd>{PALETTE_SHORTCUT}</Kbd>
        </Button>
      </SidebarHeader>
      <SidebarBody label={t('nav.label')}>
        {items.map((item) => {
          const Icon = ICONS[item.id];
          const href = companyPath(company.issuePrefix, item.to);
          return (
            <SidebarItem
              key={item.id}
              href={href}
              label={t(`nav.${item.id}`)}
              icon={<Icon aria-hidden />}
              badge={item.id === 'inbox' ? inboxBadge : null}
              active={isActive(item.to)}
              onNavigate={() => navigate(href)}
            />
          );
        })}
        <StockUiSidebarItem />
      </SidebarBody>
      <SidebarFooter>
        <AccountMenu />
        <LanguageSwitch />
      </SidebarFooter>
    </>
  );
}
