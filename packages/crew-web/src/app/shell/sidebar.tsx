// S0.1: sidebar. Mục chỉ hiện khi feature đã có route (không link chết). Badge Hộp thư = sidebar-badges + issue chưa đọc.
import { useQuery } from '@tanstack/react-query';
import { type ComponentType, Fragment } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, queryKeys } from '@/api';
import {
  Button,
  Kbd,
  Logo,
  SidebarBody,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarItem,
  SidebarProjectTile,
} from '@/ds';
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
  ShieldCheck,
  Sparkles,
  Users,
} from '@/ds/icons';
import { navItemVisible, navLabelKey, useCompanyAccess } from '@/features/access';
import { useContributionsSummary } from '@/features/contributions/use-contributions';
import { useInboxBadge } from '@/features/inbox/use-inbox-badge';
import { projectRef } from '@/features/projects/paths';
import { useT } from '@/i18n';
import { useCompany } from '../hooks';
import { companyPath, groupNavItems, NAV_ITEMS, type NavId } from '../routes-util';
import { AccountMenu } from './account-menu';
import { CompanySwitcher } from './company-switcher';
import { LanguageSwitch } from './language-switch';
import { starredProjects } from './starred-projects';
import { StockUiSidebarItem } from './stock-ui-link';

/** Ký hiệu phím tắt, không phải chữ cần dịch. */
const PALETTE_SHORTCUT = '⌘K';

const ICONS: Record<NavId, ComponentType<{ 'aria-hidden'?: boolean }>> = {
  newIssue: Plus,
  search: Search,
  dashboard: LayoutDashboard,
  inbox: Inbox,
  issues: ListChecks,
  contributions: ShieldCheck,
  members: Users,
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
  const access = useCompanyAccess();
  const items = NAV_ITEMS.filter((i) => segments.has(i.segment) && navItemVisible(i.id, access));
  const groups = groupNavItems(items);
  const contributionsBadge = useContributionsSummary(
    company.id,
    items.some((i) => i.id === 'contributions'),
  );
  // Project gắn sao nằm ngay dưới mục "Project" như sidebar Paperclip; chưa tải xong thì không hiện gì.
  const hasProjects = segments.has('projects');
  const projects = useQuery({
    queryKey: queryKeys.projects(company.id),
    queryFn: () => api.projects.list(company.id),
    enabled: hasProjects,
  });
  const prefs = useQuery({
    queryKey: queryKeys.sidebarPreferences(company.id),
    queryFn: () => api.sidebar.preferences(company.id),
    enabled: hasProjects,
  });
  const starred = starredProjects(projects.data ?? [], prefs.data?.orderedIds ?? []);
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
        {groups.map((group) => (
          <SidebarGroup key={group.id} label={group.id === 'main' ? undefined : t(`nav.group.${group.id}`)}>
            {group.items.map((item) => {
              const Icon = ICONS[item.id];
              const href = companyPath(company.issuePrefix, item.to);
              return (
                <Fragment key={item.id}>
                  <SidebarItem
                    href={href}
                    label={t(navLabelKey(item.id, access))}
                    icon={<Icon aria-hidden />}
                    badge={item.id === 'inbox' ? inboxBadge : item.id === 'contributions' ? contributionsBadge : null}
                    active={isActive(item.to)}
                    onNavigate={() => navigate(href)}
                  />
                  {item.id === 'projects'
                    ? starred.map((project) => {
                        const projectHref = companyPath(company.issuePrefix, `projects/${projectRef(project)}`);
                        return (
                          <SidebarItem
                            key={project.id}
                            nested
                            href={projectHref}
                            label={project.name}
                            icon={<SidebarProjectTile color={project.color} />}
                            active={pathname === projectHref || pathname.startsWith(`${projectHref}/`)}
                            onNavigate={() => navigate(projectHref)}
                          />
                        );
                      })
                    : null}
                </Fragment>
              );
            })}
            {group.id === 'system' ? <StockUiSidebarItem /> : null}
          </SidebarGroup>
        ))}
      </SidebarBody>
      <SidebarFooter>
        <AccountMenu />
        <LanguageSwitch />
      </SidebarFooter>
    </>
  );
}
