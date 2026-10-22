// Trang Roadmap: bản đồ công ty → project → yêu cầu do người tạo → cây việc con, và nhánh Docs của project (thư mục →
// trang). Bấm nút đi sâu thì camera phóng vào rồi đổi tầng; Lùi/breadcrumb/Esc/Back trình duyệt thì thu ra. Bấm việc con
// mở popup chi tiết yêu cầu (`?issue=`), bấm trang docs mở popup đọc (`?doc=`). Dạng danh sách (`?view=list`) cho cùng
// nội dung. Chỉ hiện project người xem được cấp; deep link tới thứ không được xem ra cùng một thông báo chung.
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useCompany } from '@/app/hooks';
import {
  Alert,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  RoadmapCanvas,
  type RoadmapDirection,
  type RoadmapLevel,
  RoadmapList,
  type RoadmapListItem,
  type RoadmapNode,
  Spinner,
} from '@/ds';
import { ArrowLeft } from '@/ds/icons';
import { popupIssueRef } from '@/features/issues/popup/issue-href';
import { useIssueOpener } from '@/features/issues/popup/issue-nav';
import { displayStatus, useQcStates } from '@/features/qc';
import { useT } from '@/i18n';
import { RoadmapDocReader } from './roadmap-doc-reader';
import {
  buildCompanyLevel,
  buildDocsLevel,
  buildProjectLevel,
  buildRequestLevel,
  COMPANY_ID,
  docsNodeId,
  docsParentFolder,
  docsPathOf,
  folderNodeId,
  folderTrail,
  NO_PROJECT,
  type ProjectDocs,
  type RoadmapIssue,
  resolveDocsFolder,
} from './roadmap-model';
import {
  docHref,
  levelDepth,
  levelKeyOf,
  parentTarget,
  parseRoadmapParams,
  type RoadmapTarget,
  roadmapHref,
  viewHref,
} from './roadmap-url';
import { useRoadmapData } from './use-roadmap';

/** Trạng thái history của mục do popup docs đẩy vào: đóng popup thì lùi một bước. */
interface DocPopupState {
  roadmapDoc: true;
}
const pushedByDocPopup = (state: unknown) =>
  typeof state === 'object' && state !== null && (state as Partial<DocPopupState>).roadmapDoc === true;

type Resolved =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; retry: () => void }
  | { kind: 'notFound' }
  | { kind: 'ready'; level: RoadmapLevel; list: RoadmapListItem[]; truncated: boolean };

/** Cây danh sách: tầng cây (mọi bố cục trừ vòng) lồng theo `parentId`, tầng vòng phẳng. */
function listItems(level: RoadmapLevel): RoadmapListItem[] {
  if (level.layout === 'rings') return level.nodes.map((node) => ({ node, children: [] }));
  const byParent = new Map<string, RoadmapNode[]>();
  for (const node of level.nodes) {
    const list = byParent.get(node.parentId ?? '') ?? [];
    list.push(node);
    byParent.set(node.parentId ?? '', list);
  }
  const build = (id: string): RoadmapListItem[] =>
    (byParent.get(id) ?? []).map((node) => ({ node, children: build(node.id) }));
  return build(level.center.id);
}

const isEditable = (el: Element | null) =>
  !!el &&
  (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable);

export function RoadmapPage() {
  const { t } = useT('roadmap');
  const { company } = useCompany();
  const location = useLocation();
  const navigate = useNavigate();
  const issues = useIssueOpener();
  const params = parseRoadmapParams(location.search);
  const depth = levelDepth(params);

  const data = useRoadmapData(company.id, {
    project: params.project,
    request: params.request,
    needDocs: depth >= 1 && !params.request,
    doc: params.doc,
  });
  const { request } = data;
  const { visible, projects } = data;
  // Yêu cầu của Phòng QC đã Xong: thẻ hiện trạng thái QC (Chờ QC duyệt, QC verified) thay cho Hoàn thành.
  const qcStates = useQcStates().byIssue;
  const statusOf = (issue: RoadmapIssue) => displayStatus(issue, qcStates);

  const go = useCallback((target: RoadmapTarget) => navigate(roadmapHref(location, target)), [navigate, location]);
  // Nhánh docs: tầng chỉ có một thư mục (không trang) tự đi xuống; khóa tầng, breadcrumb và nút lùi theo thư mục hiện ra.
  const docsPages = params.docs ? data.tree.data?.pages : undefined;
  const folder = docsPages ? resolveDocsFolder(docsPages, params.folder) : params.folder;
  const upTarget = (): RoadmapTarget | null => {
    if (!docsPages) return parentTarget(params);
    const parent = docsParentFolder(docsPages, folder);
    return parent === 'project' ? { project: params.project } : { project: params.project, docs: true, folder: parent };
  };
  const up = () => {
    const target = upTarget();
    if (target) go(target);
  };

  // ---- Dựng tầng đang xem -------------------------------------------------------------------------------------------
  const projectNode = useMemo(() => {
    if (!params.project) return null;
    if (params.project === NO_PROJECT) {
      return visible.all ? { id: NO_PROJECT, title: t('noProject'), color: null } : null;
    }
    const p = projects.data?.find((x) => x.id === params.project && !x.archivedAt);
    return p ? { id: p.id, title: p.name, color: p.color ?? null } : null;
  }, [params.project, projects.data, visible.all, t]);

  const docsError = data.docsProjects.error ?? data.tree.error;
  const docs: ProjectDocs =
    !params.project || params.project === NO_PROJECT
      ? undefined
      : data.docsProjects.isSuccess && !data.hasDocs
        ? null
        : data.tree.isSuccess
          ? data.tree.data
            ? { pages: data.tree.data.pages.length }
            : null
          : docsError
            ? null
            : 'loading';

  const resolve = (list: boolean): Resolved => {
    const cap = list ? Number.POSITIVE_INFINITY : undefined;
    if (!visible.ready || projects.isPending || data.company.isPending) {
      if (visible.error) return { kind: 'error', message: visible.error.message, retry: visible.retry };
      if (projects.error)
        return { kind: 'error', message: projects.error.message, retry: () => void projects.refetch() };
      if (data.company.error) {
        return { kind: 'error', message: data.company.error.message, retry: () => void data.company.refetch() };
      }
      return { kind: 'loading' };
    }
    const companyTruncated = data.company.data?.truncated ?? false;
    if (!params.project) {
      const level = buildCompanyLevel({
        companyName: company.name,
        projects: projects.data ?? [],
        issues: data.company.data?.items ?? [],
        includeNoProject: visible.all,
        noProjectTitle: t('noProject'),
        cap,
      });
      return { kind: 'ready', level, list: listItems(level), truncated: companyTruncated };
    }
    if (!projectNode) return { kind: 'notFound' };
    const ofProject = params.project === NO_PROJECT ? data.company : data.project;
    if (!ofProject.data) {
      if (ofProject.error) {
        return { kind: 'error', message: ofProject.error.message, retry: () => void ofProject.refetch() };
      }
      return { kind: 'loading' };
    }
    const projectTruncated = ofProject.data.truncated;
    if (params.docs) {
      if (docsError) {
        return {
          kind: 'error',
          message: docsError.message,
          retry: () => void (data.docsProjects.error ? data.docsProjects.refetch() : data.tree.refetch()),
        };
      }
      if (docs === 'loading') return { kind: 'loading' };
      if (!docs || !data.tree.data) return { kind: 'notFound' };
      const level = buildDocsLevel({
        projectId: projectNode.id,
        pages: data.tree.data.pages,
        folder,
        cap,
      });
      return level ? { kind: 'ready', level, list: listItems(level), truncated: false } : { kind: 'notFound' };
    }
    if (params.request) {
      // Dữ liệu tạm (lấy từ danh sách cả company, có thể bị cắt) chưa có yêu cầu thì chờ danh sách của project.
      if (!request) return ofProject.isPlaceholderData ? { kind: 'loading' } : { kind: 'notFound' };
      if (!data.subtree.data) {
        if (data.subtree.error) {
          return { kind: 'error', message: data.subtree.error.message, retry: () => void data.subtree.refetch() };
        }
        return { kind: 'loading' };
      }
      const names = new Map((data.agents.data ?? []).map((a) => [a.id, a.name]));
      const level = buildRequestLevel({
        request,
        descendants: data.subtree.data.items,
        agentName: (id) => names.get(id),
        runs: data.runs.data,
        jev: data.jev.data,
        statusOf,
        cap,
      });
      return { kind: 'ready', level, list: listItems(level), truncated: data.subtree.data.truncated };
    }
    const level = buildProjectLevel({ project: projectNode, issues: ofProject.data.items, docs, statusOf, cap });
    return { kind: 'ready', level, list: listItems(level), truncated: projectTruncated };
  };
  const current = resolve(params.view === 'list');
  const key = levelKeyOf({ ...params, folder });

  // Giữ tầng cũ trên màn hình trong lúc tầng mới đang tải, để camera không giật về trạng thái chờ.
  const shown = useRef<{ key: string; resolved: Extract<Resolved, { kind: 'ready' }> } | null>(null);
  if (current.kind === 'ready') shown.current = { key, resolved: current };
  else if (current.kind !== 'loading') shown.current = null;
  const display = shown.current;

  // Hướng chuyển tầng tính một lần cho mỗi khóa tầng hiện trên màn hình (cập nhật live cùng tầng không đổi gì).
  const trailOf = (): string[] => {
    const trail = [COMPANY_ID];
    if (params.project) trail.push(params.project);
    if (request) trail.push(request.id);
    if (params.docs && params.project) {
      trail.push(docsNodeId(params.project));
      for (const f of folderTrail(folder)) trail.push(folderNodeId(f.path));
    }
    return trail;
  };
  const motion = useRef<{ key: string; trail: string[]; direction: RoadmapDirection; focusId: string | null } | null>(
    null,
  );
  if (display && motion.current?.key !== display.key) {
    const prev = motion.current;
    const trail = trailOf();
    let direction: RoadmapDirection = 'in';
    let focusId: string | null = null;
    if (prev) {
      const prevDepth = prev.trail.length - 1;
      const nextDepth = trail.length - 1;
      if (nextDepth < prevDepth) {
        direction = 'out';
        focusId = prev.trail[nextDepth + 1] ?? null;
      } else if (nextDepth === prevDepth && trail.join('|') === prev.trail.join('|')) direction = 'none';
    }
    motion.current = { key: display.key, trail, direction, focusId };
  }

  // ---- Hành động ----------------------------------------------------------------------------------------------------
  const openDoc = useCallback(
    (path: string) => {
      const state: DocPopupState = { roadmapDoc: true };
      navigate(docHref(location, path), { state, preventScrollReset: true });
    },
    [navigate, location],
  );
  const closeDoc = useCallback(() => {
    if (pushedByDocPopup(location.state)) navigate(-1);
    else navigate(docHref(location, null), { replace: true, preventScrollReset: true });
  }, [navigate, location]);

  const onOpen = (node: RoadmapNode) => {
    const center = display?.resolved.level.center.id === node.id;
    if (node.kind === 'more') {
      navigate(viewHref(location, 'list'));
      return;
    }
    if (center) {
      if (node.kind === 'request' && node.identifier) issues.open(node.identifier);
      else up();
      return;
    }
    switch (node.kind) {
      case 'project':
        go({ project: node.id });
        return;
      case 'request':
        if (node.identifier) go({ project: params.project, request: node.identifier });
        return;
      case 'ticket':
        if (node.identifier) issues.open(node.identifier);
        return;
      case 'docs':
        go({ project: params.project, docs: true });
        return;
      case 'folder':
        go({ project: params.project, docs: true, folder: docsPathOf(node) });
        return;
      case 'page':
        openDoc(docsPathOf(node));
        return;
      default:
        return;
    }
  };

  // Esc lùi một tầng khi không có popup hay hộp thoại nào đang mở và không gõ trong ô nhập.
  const escRef = useRef<() => void>(() => {});
  escRef.current = () => {
    if (popupIssueRef(location.search) || params.doc) return;
    up();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]') || isEditable(document.activeElement)) return;
      escRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ---- Đầu trang ----------------------------------------------------------------------------------------------------
  const crumbs: { id: string; label: string; target: RoadmapTarget | null }[] = [
    { id: 'company', label: company.name, target: {} },
  ];
  if (params.project)
    crumbs.push({ id: 'project', label: projectNode?.title ?? params.project, target: { project: params.project } });
  if (params.request) {
    crumbs.push({
      id: 'request',
      label: request ? `${request.identifier} ${request.title}` : params.request,
      target: { project: params.project, request: params.request },
    });
  }
  if (params.docs) {
    crumbs.push({ id: 'docs', label: t('docs'), target: { project: params.project, docs: true } });
    for (const f of folderTrail(folder)) {
      crumbs.push({
        id: `dir:${f.path}`,
        label: f.name,
        target: { project: params.project, docs: true, folder: f.path },
      });
    }
  }
  const breadcrumb = (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <Fragment key={c.id}>
              {i > 0 ? <BreadcrumbSeparator /> : null}
              <BreadcrumbItem>
                {last || !c.target ? (
                  <BreadcrumbPage>{c.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={roadmapHref(location, c.target)}>{c.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
  const actions = (
    <>
      <Button variant="outline" size="sm" disabled={depth === 0} onClick={up} title={t('backHint')}>
        <ArrowLeft aria-hidden />
        {t('back')}
      </Button>
      <span className="flex-1" />
      {(['map', 'list'] as const).map((view) => (
        <Button
          key={view}
          variant={params.view === view ? 'secondary' : 'outline'}
          size="sm"
          aria-pressed={params.view === view}
          onClick={() => navigate(viewHref(location, view), { replace: true })}
        >
          {t(`view.${view}`)}
        </Button>
      ))}
    </>
  );
  const header = (
    <>
      <PageHeader title={t('title')} description={t('description')} breadcrumb={breadcrumb} />
      <FilterBar>{actions}</FilterBar>
    </>
  );

  const docPopup =
    params.doc && params.project ? (
      <RoadmapDocReader
        companyPrefix={company.issuePrefix}
        projectId={params.project}
        path={params.doc}
        page={data.page}
        tree={data.tree.data ?? null}
        onOpen={(to) => navigate(docHref(location, to), { replace: true, state: location.state })}
        onClose={closeDoc}
      />
    ) : null;

  let body: ReactNode;
  if (visible.ready && visible.restricted && projects.data && projects.data.length === 0) {
    body = <EmptyState title={t('common:access.noProjectsYet')} description={t('common:access.noProjectsYetHint')} />;
  } else if (current.kind === 'error') {
    body = (
      <ErrorState
        title={t('loadFailed')}
        message={current.message}
        retryLabel={t('common:action.retry')}
        onRetry={current.retry}
      />
    );
  } else if (current.kind === 'notFound') {
    const target = parentTarget(params) ?? {};
    body = (
      <EmptyState
        title={t('notFound')}
        description={t('notFoundHint')}
        action={
          <Button variant="outline" onClick={() => go(target)}>
            <ArrowLeft aria-hidden />
            {t('back')}
          </Button>
        }
      />
    );
  } else if (!display) {
    body = <Spinner />;
  } else {
    const { level, list, truncated } = display.resolved;
    const m = motion.current;
    body = (
      <div className="flex flex-col gap-3">
        {truncated ? <Alert variant="warning" title={t('truncated', { limit: 1000 })} /> : null}
        {params.view === 'list' ? (
          <RoadmapList
            label={t('listLabel')}
            center={level.center}
            items={list}
            empty={t(`empty.${level.center.kind}`, { defaultValue: t('empty.default') })}
            onOpen={onOpen}
          />
        ) : (
          <RoadmapCanvas
            level={level}
            levelKey={display.key}
            direction={m?.direction ?? 'in'}
            focusId={m?.focusId ?? null}
            onOpen={onOpen}
            labels={{ canvas: t('canvasLabel'), hint: hintFor(level, t) }}
          />
        )}
      </div>
    );
  }

  return (
    <>
      {header}
      {body}
      {docPopup}
    </>
  );
}

function hintFor(level: RoadmapLevel, t: ReturnType<typeof useT>['t']): string {
  const kind = level.center.kind;
  const empty = level.nodes.filter((n) => n.kind !== 'docs').length === 0;
  if (kind === 'company') return t('hint.company');
  if (kind === 'project') return empty ? t('hint.emptyProject') : t('hint.project');
  if (kind === 'request') return empty ? t('hint.noChildren') : t('hint.request');
  return t('hint.docs');
}
