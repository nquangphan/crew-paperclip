// crew: tự dựng
import type { CompactIssue } from '@paperclipai/shared';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import type { Contribution, CrewRoot } from '@/api';
import { useCompany } from '@/app/hooks';
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  EmptyState,
  ErrorState,
  FilterBar,
  Label,
  MutedText,
  PageHeader,
  resolveStageKey,
  Section,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StageBadge,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds';
import { ChevronDown, ChevronRight, Plus } from '@/ds/icons';
import { useCompanyAccess } from '@/features/access';
import { ContributionActions } from '@/features/contributions/contribution-actions';
import { ContributionBadge } from '@/features/contributions/contribution-badge';
import { contributionHref } from '@/features/contributions/contribution-popup-host';
import { useAuthorNames, useContributions } from '@/features/contributions/use-contributions';
import { useSelectableAgents } from '@/features/wizards';
import { useT } from '@/i18n';
import { NewRequestDialog } from '../new/new-request-dialog';
import { IssueLink } from '../popup/issue-nav';
import { buildIssueTree, flattenTree, type TreeNode } from './tree';
import {
  COLUMN_IDS,
  type ColumnId,
  GROUP_KEYS,
  type GroupKey,
  KIND_FILTERS,
  matchesKind,
  parseListState,
  patchParams,
  SORT_KEYS,
  STATUS_OPTIONS,
  sortCompare,
  useIssuesData,
} from './use-issues';

const ALL = '__all';

interface FilterSelectProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  allLabel: string;
  onChange: (value: string) => void;
}

function FilterSelect({ label, value, options, allLabel, onChange }: FilterSelectProps) {
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? '' : v)}>
      <SelectTrigger size="sm" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Tham số URL của chip "Chờ duyệt": bật thì chỉ hiện nhóm yêu cầu góp ý chờ duyệt. */
const PENDING_PARAM = 'pending';

interface PendingGroupProps {
  items: Contribution[];
  showAuthor: boolean;
  projectName: ReadonlyMap<string, string>;
}

/** Nhóm "Chờ duyệt" đầu trang: yêu cầu góp ý chưa vào lõi. Owner có nút Duyệt/Từ chối; khách chỉ thấy mục của mình. */
function PendingGroup({ items, showAuthor, projectName }: PendingGroupProps) {
  const { t } = useT('contributions');
  const location = useLocation();
  const authorName = useAuthorNames();
  return (
    <Section title={t('issuesGroup.title')}>
      <ul aria-label={t('issuesGroup.label')} className="flex flex-col gap-3">
        {items.map((c) => (
          <li key={c.id} data-testid="pending-issue" data-status={c.status} className="flex flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <ContributionBadge status={c.status} />
              <Link to={contributionHref(c.id, location)}>{c.title ?? t('page.row.noTitle')}</Link>
            </span>
            <span className="flex flex-wrap items-center gap-4">
              {showAuthor ? (
                <MutedText>
                  {t('page.row.author')}: {authorName(c.authorUserId) ?? c.authorUserId}
                </MutedText>
              ) : null}
              {c.projectId && projectName.get(c.projectId) ? (
                <MutedText>
                  {t('page.row.project')}: {projectName.get(c.projectId)}
                </MutedText>
              ) : null}
            </span>
            <ContributionActions contribution={c} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

interface Notice {
  identifier: string;
  draft: boolean;
  failedUploads: string[];
}

export function IssuesPage() {
  const { t } = useT('issues');
  const { t: tc } = useT();
  const { t: tg } = useT('contributions');
  const { company } = useCompany();
  const access = useCompanyAccess();
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => parseListState(params), [params]);
  const { issues, roots, projects, agents } = useIssuesData(company.id, state);
  const selectable = useSelectableAgents(company.id);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [search, setSearch] = useState(state.q);

  const patch = (change: Parameters<typeof patchParams>[1]) =>
    setParams((prev) => patchParams(prev, change), { replace: true });

  // Gõ tìm kiếm không đẩy URL mỗi phím: chờ ngừng gõ rồi mới ghi.
  useEffect(() => {
    if (search === state.q) return;
    const timer = setTimeout(() => setParams((prev) => patchParams(prev, { q: search }), { replace: true }), 300);
    return () => clearTimeout(timer);
  }, [search, state.q, setParams]);
  useEffect(() => setSearch(state.q), [state.q]);

  // Yêu cầu góp ý chờ duyệt (gồm đang duyệt dở): owner thấy mọi mục, khách thấy mục của mình, người khác không gọi.
  const pendingQuery = useContributions(
    { status: 'pending', kind: 'issue' },
    { enabled: access.isOwner || access.isContributor },
  );
  const pending = (access.isOwner || access.isContributor ? pendingQuery.data : undefined) ?? [];
  const pendingOnly = params.get(PENDING_PARAM) === '1';
  const togglePendingOnly = () =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (pendingOnly) next.delete(PENDING_PARAM);
        else next.set(PENDING_PARAM, '1');
        return next;
      },
      { replace: true },
    );

  const rootsById = useMemo(() => new Map<string, CrewRoot>((roots.data ?? []).map((r) => [r.id, r])), [roots.data]);
  const projectName = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p.name])), [projects.data]);
  const agentName = useMemo(() => new Map((agents.data ?? []).map((a) => [a.id, a.name])), [agents.data]);

  const visible = useMemo(
    () => (issues.data ?? []).filter((i) => matchesKind(i, state.kind, rootsById)),
    [issues.data, state.kind, rootsById],
  );
  const tree = useMemo(() => buildIssueTree(visible, sortCompare(state.sort)), [visible, state.sort]);

  const groupLabel = (issue: CompactIssue, group: GroupKey): string => {
    if (group === 'status') return tc(`status.${issue.status}`, { defaultValue: issue.status });
    if (group === 'project') return (issue.projectId && projectName.get(issue.projectId)) || t('list.noProject');
    if (group === 'assignee')
      return (issue.assigneeAgentId && agentName.get(issue.assigneeAgentId)) || t('list.unassigned');
    return '';
  };

  const groups: { label: string | null; nodes: TreeNode<CompactIssue>[] }[] = [];
  if (state.group === 'none') {
    groups.push({ label: null, nodes: tree });
  } else {
    for (const node of tree) {
      const label = groupLabel(node.issue, state.group);
      const found = groups.find((g) => g.label === label);
      if (found) found.nodes.push(node);
      else groups.push({ label, nodes: [node] });
    }
  }

  const show = (id: ColumnId) => !state.hidden.includes(id);
  const colCount = 3 + COLUMN_IDS.filter(show).length;
  const hasFilters = [...params.keys()].some((key) => key !== 'new');

  const toggleBranch = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const setNewOpen = (open: boolean) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (open) next.set('new', '1');
        else next.delete('new');
        return next;
      },
      { replace: true },
    );

  const renderRow = (node: TreeNode<CompactIssue>) => {
    const { issue } = node;
    const root = rootsById.get(issue.id);
    const isOpen = !collapsed.has(issue.id);
    return (
      <TableRow key={issue.id} data-testid="issue-row" data-issue-id={issue.id} data-depth={node.depth}>
        <TableCell>{issue.identifier ?? issue.id}</TableCell>
        <TableCell>
          <span className="flex min-w-0 items-center gap-1">
            <span aria-hidden>{'    '.repeat(node.depth)}</span>
            {node.children.length > 0 ? (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={isOpen ? t('list.collapse') : t('list.expand')}
                aria-expanded={isOpen}
                onClick={() => toggleBranch(issue.id)}
              >
                {isOpen ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
              </Button>
            ) : null}
            <span className="min-w-0 truncate">
              <IssueLink identifier={issue.identifier ?? issue.id}>{issue.title}</IssueLink>
            </span>
          </span>
        </TableCell>
        <TableCell>
          <StatusBadge status={issue.status} />
        </TableCell>
        {show('stage') ? (
          <TableCell>{root ? <StageBadge stage={resolveStageKey(root.stage, root.kind)} /> : null}</TableCell>
        ) : null}
        {show('progress') ? (
          <TableCell>
            {root && root.totalChildren > 0
              ? t('list.progress', { done: root.doneChildren, total: root.totalChildren })
              : null}
          </TableCell>
        ) : null}
        {show('project') ? (
          <TableCell>{issue.projectId ? (projectName.get(issue.projectId) ?? '') : ''}</TableCell>
        ) : null}
        {show('assignee') ? (
          <TableCell>{issue.assigneeAgentId ? (agentName.get(issue.assigneeAgentId) ?? '') : ''}</TableCell>
        ) : null}
      </TableRow>
    );
  };

  const body = () => {
    if (issues.isLoading) return <Skeleton aria-label={tc('ui.loading')} />;
    if (issues.error) {
      return (
        <ErrorState title={t('page.loadFailed')} message={issues.error.message} onRetry={() => void issues.refetch()} />
      );
    }
    if (tree.length === 0) {
      return <EmptyState title={hasFilters ? t('page.emptyFiltered') : t('page.empty')} />;
    }
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('list.col.id')}</TableHead>
            <TableHead>{t('list.col.title')}</TableHead>
            <TableHead>{t('list.col.status')}</TableHead>
            {show('stage') ? <TableHead>{t('list.col.stage')}</TableHead> : null}
            {show('progress') ? <TableHead>{t('list.col.progress')}</TableHead> : null}
            {show('project') ? <TableHead>{t('list.col.project')}</TableHead> : null}
            {show('assignee') ? <TableHead>{t('list.col.assignee')}</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => (
            <Fragment key={group.label ?? 'all'}>
              {group.label !== null ? (
                <TableRow>
                  <TableHead colSpan={colCount} data-testid="group-heading">
                    {group.label} ({group.nodes.length})
                  </TableHead>
                </TableRow>
              ) : null}
              {flattenTree(group.nodes, (n) => !collapsed.has(n.issue.id)).map(renderRow)}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t('page.title')}
        description={t('page.description')}
        actions={
          <Button onClick={() => setNewOpen(true)}>
            <Plus aria-hidden />
            {t('new.button')}
          </Button>
        }
      />
      {notice ? (
        <Card role="status">
          <CardContent className="flex flex-col gap-2">
            <span className="flex items-center gap-2">
              {t(notice.draft ? 'page.createdDraft' : 'page.created', { identifier: notice.identifier })}
              <IssueLink identifier={notice.identifier}>{t('page.open')}</IssueLink>
            </span>
            {notice.failedUploads.length > 0 ? (
              <ErrorState title={t('page.uploadFailed', { names: notice.failedUploads.join(', ') })} />
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: t('list.search') }}
        onReset={() =>
          setParams(new URLSearchParams(params.get('new') ? { new: params.get('new') as string } : {}), {
            replace: true,
          })
        }
      >
        <FilterSelect
          label={t('list.status')}
          value={state.status}
          allLabel={t('list.all')}
          options={STATUS_OPTIONS.map((s) => ({ value: s, label: tc(`status.${s}`) }))}
          onChange={(v) => patch({ status: v })}
        />
        <FilterSelect
          label={t('list.project')}
          value={state.projectId}
          allLabel={t('list.all')}
          options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
          onChange={(v) => patch({ projectId: v })}
        />
        <FilterSelect
          label={t('list.assignee')}
          value={state.assigneeAgentId}
          allLabel={t('list.all')}
          options={selectable(agents.data, [state.assigneeAgentId]).map((a) => ({ value: a.id, label: a.name }))}
          onChange={(v) => patch({ assigneeAgentId: v })}
        />
        <FilterSelect
          label={t('list.kind')}
          value={state.kind === 'all' ? '' : state.kind}
          allLabel={t('list.all')}
          options={KIND_FILTERS.filter((k) => k !== 'all').map((k) => ({ value: k, label: t(`list.kindOption.${k}`) }))}
          onChange={(v) => patch({ kind: v })}
        />
        <FilterSelect
          label={t('list.sort')}
          value={state.sort === 'updated' ? '' : state.sort}
          allLabel={t('list.sortOption.updated')}
          options={SORT_KEYS.filter((s) => s !== 'updated').map((s) => ({
            value: s,
            label: t(`list.sortOption.${s}`),
          }))}
          onChange={(v) => patch({ sort: v })}
        />
        <FilterSelect
          label={t('list.group')}
          value={state.group === 'none' ? '' : state.group}
          allLabel={t('list.none')}
          options={GROUP_KEYS.filter((g) => g !== 'none').map((g) => ({ value: g, label: t(`list.groupOption.${g}`) }))}
          onChange={(v) => patch({ group: v })}
        />
        {pending.length > 0 || pendingOnly ? (
          <Button
            type="button"
            size="sm"
            variant={pendingOnly ? 'secondary' : 'outline'}
            aria-pressed={pendingOnly}
            data-testid="pending-chip"
            onClick={togglePendingOnly}
          >
            {tg('issuesGroup.chip', { count: pending.length })}
          </Button>
        ) : null}
      </FilterBar>
      <fieldset className="flex flex-wrap items-center gap-3">
        <legend>{t('list.columns')}</legend>
        {COLUMN_IDS.map((id) => (
          <span key={id} className="flex items-center gap-1">
            <Checkbox
              id={`col-${id}`}
              checked={show(id)}
              onCheckedChange={(checked) =>
                patch({
                  hidden: (checked ? state.hidden.filter((c) => c !== id) : [...state.hidden, id]).join(',') || null,
                })
              }
            />
            <Label htmlFor={`col-${id}`}>{t(`list.col.${id}`)}</Label>
          </span>
        ))}
      </fieldset>
      {pending.length > 0 ? (
        <PendingGroup items={pending} showAuthor={access.isOwner} projectName={projectName} />
      ) : pendingOnly ? (
        pendingQuery.error ? (
          <ErrorState title={tg('issuesGroup.loadFailed')} message={pendingQuery.error.message} />
        ) : (
          <EmptyState title={tg('issuesGroup.empty')} />
        )
      ) : null}
      {pendingOnly ? null : body()}
      <NewRequestDialog
        open={params.get('new') === '1'}
        onOpenChange={setNewOpen}
        companyId={company.id}
        onCreated={(issue, info) =>
          setNotice({ identifier: issue.identifier ?? issue.id, draft: info.draft, failedUploads: info.failedUploads })
        }
      />
    </div>
  );
}
