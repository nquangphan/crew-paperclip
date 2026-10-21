// crew: tự dựng
// Danh sách Yêu cầu theo bố cục IssuesList (streamlined) của Paperclip: thanh công cụ một hàng (Yêu cầu mới, ô tìm,
// Cột/Lọc/Sắp xếp/Nhóm), dòng task không kẻ có glyph trạng thái, tiêu đề, cột phụ, mã và thời gian, nhóm thu gọn được,
// vạch Hôm nay/Hôm qua. Giữ phần Crew: cột giai đoạn và x/y con xong, nhóm và chip Chờ duyệt, chế độ chỉ đọc.
// Nút Danh sách/Bảng như Paperclip: chế độ Bảng (`issues-board.tsx`) dùng cùng dữ liệu và bộ lọc, ẩn Sắp xếp/Nhóm, hiện
// nút mật độ bảng. Mọi trạng thái xem nằm trong URL (`use-issues.ts`), trừ nhóm/nhánh đang thu gọn.
import type { CompactIssue } from '@paperclipai/shared';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import type { Contribution, CrewRoot } from '@/api';
import { useCompany } from '@/app/hooks';
import {
  Button,
  Card,
  CardContent,
  CollectionTitle,
  CollectionToolbar,
  DateSeparator,
  EmptyState,
  ErrorState,
  Identity,
  IssueGroup,
  IssueListRow,
  KanbanToolbarControls,
  LabelPill,
  ListItemRow,
  LiveBadge,
  MutedText,
  RowCell,
  RowNote,
  resolveStageKey,
  Skeleton,
  StageBadge,
  ToolbarChoiceMenu,
  ToolbarColumnsMenu,
  ToolbarFilterMenu,
  ToolbarSearch,
  ToolbarViewToggle,
  TreeSpacer,
  TreeToggle,
} from '@/ds';
import { CircleDot, Plus } from '@/ds/icons';
import { useCompanyAccess, useVisibleProjects } from '@/features/access';
import { ContributionActions } from '@/features/contributions/contribution-actions';
import { ContributionBadge } from '@/features/contributions/contribution-badge';
import { contributionHref } from '@/features/contributions/contribution-popup-host';
import { useAuthorLabel, useContributions } from '@/features/contributions/use-contributions';
import { useSelectableAgents } from '@/features/wizards';
import { formatDateTime, formatRelative, useT } from '@/i18n';
import { StartWorkButton } from '../detail/start-work';
import { NewRequestDialog } from '../new/new-request-dialog';
import { IssueLink, useIssueOpener } from '../popup/issue-nav';
import { boardLayout, IssuesBoard } from './issues-board';
import {
  activityAt,
  type DateGroup,
  dateGroup,
  dateSeparator,
  dateSeparatorField,
  groupIssues,
  liveIssueIds,
} from './list-view';
import { buildIssueTree, flattenTree, type TreeNode } from './tree';
import {
  COLUMN_IDS,
  type ColumnId,
  columnPatch,
  GROUP_KEYS,
  isColumnVisible,
  KIND_FILTERS,
  matchesKind,
  parseListState,
  patchParams,
  SORT_KEYS,
  STATUS_OPTIONS,
  sortCompare,
  useIssuesData,
} from './use-issues';

/** Tham số URL của chip "Chờ duyệt": bật thì chỉ hiện nhóm yêu cầu góp ý chờ duyệt. */
const PENDING_PARAM = 'pending';
/** Khóa thu gọn của nhóm Chờ duyệt (cùng tập với khóa nhóm của danh sách). */
const PENDING_GROUP = '__pending';

interface PendingGroupProps {
  items: Contribution[];
  showAuthor: boolean;
  projectName: ReadonlyMap<string, string>;
  collapsed: boolean;
  onToggle: () => void;
}

/** Nhóm "Chờ duyệt" đầu danh sách: yêu cầu góp ý chưa vào lõi. Owner có nút Duyệt/Từ chối; khách chỉ thấy mục của mình. */
function PendingGroup({ items, showAuthor, projectName, collapsed, onToggle }: PendingGroupProps) {
  const { t } = useT('contributions');
  const location = useLocation();
  const authorLabel = useAuthorLabel();
  return (
    <IssueGroup label={t('issuesGroup.title')} collapsed={collapsed} onToggle={onToggle}>
      <ul aria-label={t('issuesGroup.label')} className="flex flex-col">
        {items.map((c) => (
          <ListItemRow key={c.id} data-testid="pending-issue" data-status={c.status}>
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <ContributionBadge status={c.status} />
              <span className="min-w-0 truncate">
                <Link to={contributionHref(c.id, location)}>{c.title ?? t('page.row.noTitle')}</Link>
              </span>
            </span>
            <div className="flex flex-wrap items-center gap-4">
              {showAuthor ? (
                <MutedText>
                  {t('page.row.author')}: {authorLabel(c)}
                </MutedText>
              ) : null}
              {c.projectId && projectName.get(c.projectId) ? (
                <MutedText>
                  {t('page.row.project')}: {projectName.get(c.projectId)}
                </MutedText>
              ) : null}
            </div>
            <ContributionActions contribution={c} />
          </ListItemRow>
        ))}
      </ul>
    </IssueGroup>
  );
}

interface Notice {
  identifier: string;
  draft: boolean;
  failedUploads: string[];
}

const countDescendants = (node: TreeNode<CompactIssue>): number =>
  node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0);

const toggleIn = (set: ReadonlySet<string>, key: string): Set<string> => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

export function IssuesPage() {
  const { t, lang } = useT('issues');
  const { t: tc } = useT();
  const { t: tg } = useT('contributions');
  const { company } = useCompany();
  const access = useCompanyAccess();
  const opener = useIssueOpener();
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => parseListState(params), [params]);
  const { issues, roots, projects, agents, liveRuns } = useIssuesData(company.id, state);
  const selectable = useSelectableAgents(company.id);
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
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
  const projectAccess = useVisibleProjects();
  const pending = ((access.isOwner || access.isContributor ? pendingQuery.data : undefined) ?? []).filter((c) =>
    projectAccess.canSeeProject(c.projectId),
  );
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
  const live = useMemo(() => liveIssueIds(liveRuns.data, issues.data ?? []), [liveRuns.data, issues.data]);

  const visible = useMemo(
    () => (issues.data ?? []).filter((i) => matchesKind(i, state.kind, rootsById)),
    [issues.data, state.kind, rootsById],
  );
  const board = state.view === 'board';
  const boardIssues = useMemo(
    () => (board ? [...visible].sort(sortCompare(state.sort)) : []),
    [board, visible, state.sort],
  );
  const layout = boardLayout(state, boardIssues.length);
  const groups = useMemo(
    () =>
      groupIssues(visible, state.group, {
        status: (s) => tc(`status.${s}`, { defaultValue: s }),
        project: (id) => projectName.get(id),
        agent: (id) => agentName.get(id),
        noProject: t('list.noProject'),
        unassigned: t('list.unassigned'),
      }).map((g) => ({ ...g, tree: buildIssueTree(g.items, sortCompare(state.sort)) })),
    [visible, state.group, state.sort, projectName, agentName, tc, t],
  );

  const show = (id: ColumnId) => isColumnVisible(state, id);
  const canCreate = !access.readOnly || access.isContributor;
  const filterCount = [
    state.status,
    state.projectId,
    state.assigneeAgentId,
    state.kind === 'all' ? '' : state.kind,
  ].filter(Boolean).length;

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

  const newButton = (
    // Viewer thuần không tạo được yêu cầu; khách góp ý mở dialog gửi chờ duyệt.
    <Button size="sm" variant="outline" aria-label={t('new.button')} onClick={() => setNewOpen(true)}>
      <Plus aria-hidden />
      <span className="hidden sm:inline-flex">{t('new.button')}</span>
    </Button>
  );

  const metadata = (issue: CompactIssue): ReactNode => {
    const root = rootsById.get(issue.id);
    const assignee = issue.assigneeAgentId ? agentName.get(issue.assigneeAgentId) : undefined;
    const project = issue.projectId ? projectName.get(issue.projectId) : undefined;
    const labels = issue.labels ?? [];
    return (
      <>
        <StartWorkButton issue={issue} size="xs" />
        {live.has(issue.id) ? <LiveBadge label={t('list.live')} /> : null}
        {show('stage') ? (
          <RowCell size="lg">{root ? <StageBadge stage={resolveStageKey(root.stage, root.kind)} /> : null}</RowCell>
        ) : null}
        {show('progress') ? (
          <RowCell size="sm">
            {root && root.totalChildren > 0
              ? t('list.progress', { done: root.doneChildren, total: root.totalChildren })
              : null}
          </RowCell>
        ) : null}
        {show('assignee') ? (
          <RowCell size="lg" title={assignee}>
            {assignee ? <Identity name={assignee} /> : null}
          </RowCell>
        ) : null}
        {show('project') ? (
          <RowCell size="md" title={project}>
            {project ?? null}
          </RowCell>
        ) : null}
        {show('labels') ? (
          <RowCell size="sm" title={labels.map((l) => l.name).join(', ') || undefined}>
            {labels.length > 0 ? <LabelPill name={labels[0].name} color={labels[0].color} /> : null}
            {labels.length > 1 ? <RowNote>+{labels.length - 1}</RowNote> : null}
          </RowCell>
        ) : null}
      </>
    );
  };

  const renderRow = (node: TreeNode<CompactIssue>) => {
    const { issue } = node;
    const identifier = issue.identifier ?? issue.id;
    const hasChildren = node.children.length > 0;
    const expanded = !collapsedParents.has(issue.id);
    const at = activityAt(issue);
    return (
      <IssueListRow
        key={issue.id}
        data-testid="issue-row"
        data-issue-id={issue.id}
        data-depth={node.depth}
        title={issue.title}
        href={opener.href(identifier)}
        onOpen={() => opener.open(identifier)}
        status={issue.status}
        statusLabel={tc(`status.${issue.status}`, { defaultValue: issue.status })}
        depth={node.depth}
        chevronInGuide={node.depth > 0 && hasChildren}
        leading={
          hasChildren ? (
            <TreeToggle
              expanded={expanded}
              label={expanded ? t('list.collapse') : t('list.expand')}
              onToggle={() => setCollapsedParents((prev) => toggleIn(prev, issue.id))}
            />
          ) : (
            <TreeSpacer />
          )
        }
        titleSuffix={
          hasChildren && !expanded ? <RowNote>{t('list.children', { count: countDescendants(node) })}</RowNote> : null
        }
        metadata={metadata(issue)}
        identifier={show('id') ? identifier : null}
        time={show('updated') ? { text: formatRelative(at, lang), title: formatDateTime(at, lang) } : null}
      />
    );
  };

  /** Dòng của một nhóm; khi sắp theo ngày (mới nhất trước) chèn vạch Hôm nay/Hôm qua/Trước đó giữa các yêu cầu gốc. */
  const renderRows = (tree: TreeNode<CompactIssue>[]) => {
    const field = dateSeparatorField(state.sort);
    const now = new Date();
    let previous: DateGroup | null = null;
    const out: ReactNode[] = [];
    for (const node of flattenTree(tree, (n) => !collapsedParents.has(n.issue.id))) {
      if (field && node.depth === 0) {
        const current = dateGroup(node.issue[field], now);
        const label = dateSeparator(previous, current);
        if (label) out.push(<DateSeparator key={`date-${node.issue.id}`} label={t(`list.date.${label}`)} />);
        previous = current;
      }
      out.push(renderRow(node));
    }
    return out;
  };

  const body = () => {
    if (issues.isLoading) return <Skeleton aria-label={tc('ui.loading')} />;
    if (issues.error) {
      return (
        <ErrorState title={t('page.loadFailed')} message={issues.error.message} onRetry={() => void issues.refetch()} />
      );
    }
    if (board) {
      return (
        <IssuesBoard
          companyId={company.id}
          issues={boardIssues}
          state={state}
          rootsById={rootsById}
          agentName={agentName}
          live={live}
          opener={opener}
          readOnly={access.readOnly}
        />
      );
    }
    if (visible.length === 0) {
      return (
        <EmptyState
          icon={<CircleDot aria-hidden />}
          title={filterCount > 0 || state.q ? t('page.emptyFiltered') : t('page.empty')}
        />
      );
    }
    return (
      <div className="flex flex-col">
        {groups.map((group) =>
          group.label === null ? (
            <div key={group.key} className="flex flex-col">
              {renderRows(group.tree)}
            </div>
          ) : (
            <IssueGroup
              key={group.key}
              label={group.label}
              headingTestId="group-heading"
              collapsed={collapsedGroups.has(group.key)}
              onToggle={() => setCollapsedGroups((prev) => toggleIn(prev, group.key))}
            >
              <div className="flex flex-col">{renderRows(group.tree)}</div>
            </IssueGroup>
          ),
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <CollectionTitle>{t('page.title')}</CollectionTitle>
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
      <CollectionToolbar
        ariaLabel={t('list.toolbar')}
        context={canCreate ? newButton : undefined}
        search={<ToolbarSearch value={search} onChange={setSearch} placeholder={t('list.search')} />}
        controls={
          <>
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
            <ToolbarViewToggle
              value={state.view}
              onChange={(v) => patch({ view: v })}
              label={t('board.viewMode')}
              listLabel={t('board.listView')}
              boardLabel={t('board.boardView')}
            />
            {board ? (
              <KanbanToolbarControls
                compact={layout.compact}
                coldCollapsed={layout.collapsedStatuses.length > 0}
                pageSize={state.pageSize}
                customized={layout.customized}
                onToggleCompact={() => patch({ density: layout.compact ? 'comfortable' : 'compact' })}
                onToggleCold={() => patch({ lanes: layout.collapsedStatuses.length > 0 ? 'expanded' : 'collapsed' })}
                onPageSize={(size) => patch({ pageSize: String(size) })}
                onReset={() => patch({ density: null, lanes: null, pageSize: null })}
                labels={{
                  compactOn: t('board.compactOn'),
                  compactOff: t('board.compactOff'),
                  coldCollapse: t('board.coldCollapse'),
                  coldExpand: t('board.coldExpand'),
                  pageSize: t('board.pageSize'),
                  perColumn: (size) => t('board.perColumn', { count: size }),
                  reset: t('board.reset'),
                }}
              />
            ) : null}
            <ToolbarColumnsMenu
              label={t('list.columns')}
              eyebrow={t('list.columnsEyebrow')}
              title={t('list.columnsTitle')}
              columns={COLUMN_IDS.map((id) => ({
                id,
                label: t(`list.col.${id}`),
                description: t(`list.colHint.${id}`),
              }))}
              isVisible={(id) => show(id as ColumnId)}
              onToggle={(id, on) => patch(columnPatch(state, id as ColumnId, on))}
              resetLabel={t('list.columnsReset')}
              onReset={() => patch({ hidden: null, shown: null })}
            />
            <ToolbarFilterMenu
              label={filterCount > 0 ? t('list.filterActive', { count: filterCount }) : t('list.filter')}
              title={t('list.filterTitle')}
              clearLabel={t('list.clear')}
              activeCount={filterCount}
              onClear={() => patch({ status: null, projectId: null, assigneeAgentId: null, kind: null })}
              sections={[
                {
                  id: 'status',
                  label: t('list.status'),
                  value: state.status,
                  onChange: (v) => patch({ status: v }),
                  options: STATUS_OPTIONS.map((s) => ({ value: s, label: tc(`status.${s}`), status: s })),
                },
                {
                  id: 'assignee',
                  label: t('list.assignee'),
                  value: state.assigneeAgentId,
                  onChange: (v) => patch({ assigneeAgentId: v }),
                  options: selectable(agents.data, [state.assigneeAgentId]).map((a) => ({
                    value: a.id,
                    label: a.name,
                  })),
                },
                {
                  id: 'project',
                  label: t('list.project'),
                  value: state.projectId,
                  onChange: (v) => patch({ projectId: v }),
                  options: (projects.data ?? []).map((p) => ({ value: p.id, label: p.name })),
                },
                {
                  id: 'kind',
                  label: t('list.kind'),
                  value: state.kind === 'all' ? '' : state.kind,
                  onChange: (v) => patch({ kind: v }),
                  options: KIND_FILTERS.filter((k) => k !== 'all').map((k) => ({
                    value: k,
                    label: t(`list.kindOption.${k}`),
                  })),
                },
              ]}
            />
            {board ? null : (
              <>
                <ToolbarChoiceMenu
                  kind="sort"
                  label={t('list.sort')}
                  value={state.sort}
                  onSelect={(v) => patch({ sort: v })}
                  options={SORT_KEYS.map((s) => ({ value: s, label: t(`list.sortOption.${s}`) }))}
                />
                <ToolbarChoiceMenu
                  kind="group"
                  label={t('list.group')}
                  value={state.group}
                  onSelect={(v) => patch({ group: v })}
                  options={[...GROUP_KEYS.filter((g) => g !== 'none'), 'none' as const].map((g) => ({
                    value: g,
                    label: t(`list.groupOption.${g}`),
                  }))}
                />
              </>
            )}
          </>
        }
      />
      {pending.length > 0 ? (
        <PendingGroup
          items={pending}
          showAuthor={access.isOwner}
          projectName={projectName}
          collapsed={collapsedGroups.has(PENDING_GROUP)}
          onToggle={() => setCollapsedGroups((prev) => toggleIn(prev, PENDING_GROUP))}
        />
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
