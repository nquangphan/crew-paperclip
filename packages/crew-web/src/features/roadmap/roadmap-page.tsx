// Trang Roadmap một trang: một bản đồ chứa công ty → project → yêu cầu do người tạo → cây việc con, cùng đảo Docs của
// project. Bấm một mục thì camera bay tới mục đó (không đổi trang); chỗ đang lấy nét nằm trên URL (`?focus=`), mỗi lần
// lấy nét đẩy một mục lịch sử nên Back trình duyệt bay về chỗ trước. Bấm lại mục đang xem, Enter hoặc nút Mở chi tiết mở
// popup chi tiết yêu cầu (`?issue=`); bấm trang docs mở popup đọc (`?doc=`). Esc / Ra ngoài ra một mức, Toàn cảnh / phím 0
// về toàn cảnh. Dạng danh sách (`?view=list`) cho cùng nội dung. Link cũ `?project=`/`?request=` tự đổi sang `?focus=`.
// Chỉ hiện project người xem được cấp; deep link tới thứ không được xem về toàn cảnh kèm một thông báo chung.
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  createIslandCache,
  EmptyState,
  ErrorState,
  FilterBar,
  Kbd,
  layoutWorld,
  PageHeader,
  RoadmapFocusCard,
  RoadmapList,
  type RoadmapNode,
  RoadmapWorldCanvas,
  RoadmapWorldSkeleton,
} from '@/ds';
import { ArrowLeft, Scan } from '@/ds/icons';
import { popupIssueRef } from '@/features/issues/popup/issue-href';
import { useIssueOpener } from '@/features/issues/popup/issue-nav';
import { displayStatus, useQcStates } from '@/features/qc';
import { useT } from '@/i18n';
import { RoadmapDocReader } from './roadmap-doc-reader';
import {
  buildWorldInput,
  type FocusTarget,
  focusOfNode,
  focusTrail,
  parentFocus,
  resolveFocus,
  type StatusOf,
  worldFocusOf,
  worldListItems,
} from './roadmap-model';
import { docHref, focusHref, legacyHref, parseRoadmapParams, viewHref } from './roadmap-url';
import { useRoadmapData } from './use-roadmap';

/** Trần nút một lần tải của `crew.roadmap` (`ROADMAP_NODE_LIMIT` của worker). */
const NODE_LIMIT = 5000;

/** Trạng thái history của mục do popup docs đẩy vào: đóng popup thì lùi một bước. */
interface DocPopupState {
  roadmapDoc: true;
}
const pushedByDocPopup = (state: unknown) =>
  typeof state === 'object' && state !== null && (state as Partial<DocPopupState>).roadmapDoc === true;

const isEditable = (el: Element | null) =>
  !!el &&
  (el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el as HTMLElement).isContentEditable);
const overlayOpen = () => !!document.querySelector('[role="dialog"], [role="alertdialog"]');

/** Id nút đang xem của chỗ lấy nét (null ở toàn cảnh/project). */
function currentIdOf(target: FocusTarget): string | null {
  return target.kind === 'request' || target.kind === 'ticket' || target.kind === 'docs' || target.kind === 'folder'
    ? target.id
    : null;
}

export function RoadmapPage() {
  const { t } = useT('roadmap');
  const { t: tg, lang } = useT();
  const { company } = useCompany();
  const location = useLocation();
  const navigate = useNavigate();
  const issues = useIssueOpener();

  // Link cũ của bản nhiều tầng: thay bằng `?focus=` (không thêm mục lịch sử).
  const legacy = legacyHref(location);
  useEffect(() => {
    if (legacy) navigate(legacy, { replace: true, state: location.state });
  }, [legacy, navigate, location.state]);
  const params = parseRoadmapParams(legacy ? new URL(legacy, 'http://x').search : location.search);

  const data = useRoadmapData(company.id, { focus: params.focus, doc: params.doc });
  const { visible, projects, roadmap } = data;
  // Yêu cầu của Phòng QC đã Xong: thẻ hiện trạng thái QC (Chờ QC duyệt, QC verified) thay cho Hoàn thành.
  const qcStates = useQcStates().byIssue;
  const statusOf = useCallback<StatusOf>((issue) => displayStatus(issue, qcStates), [qcStates]);

  // ---- Thế giới: dựng một lần cho mỗi lần dữ liệu đổi; bố cục từng đảo nhớ lại giữa các lần --------------------------
  const cache = useRef(createIslandCache());
  const runs = data.requestId && data.runs.data ? { rootId: data.requestId, data: data.runs.data } : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: lang dịch lại nhãn trên thẻ (tg đổi theo lang).
  const world = useMemo(() => {
    if (!roadmap || !projects.data || data.docs === undefined) return null;
    const input = buildWorldInput({
      companyName: company.name,
      projects: projects.data,
      roadmap,
      includeNoProject: visible.all,
      noProjectTitle: t('noProject'),
      docs: data.docs,
      runs,
      statusOf,
      t: tg,
    });
    return layoutWorld(input, cache.current);
  }, [roadmap, projects.data, data.docs, runs?.rootId, runs?.data, statusOf, company.name, visible.all, t, tg, lang]);

  const target: FocusTarget = world ? resolveFocus(world, params.focus) : { kind: 'overview' };
  const currentId = currentIdOf(target);
  const [nonce, setNonce] = useState(0);

  // ---- Hành động ----------------------------------------------------------------------------------------------------
  const goFocus = useCallback(
    (focus: string | null) => {
      if (focus === params.focus && !params.doc && !popupIssueRef(location.search)) {
        // Bấm lại đúng chỗ đang lấy nét (đã kéo đi chỗ khác): bay lại, không thêm mục lịch sử.
        setNonce((n) => n + 1);
        return;
      }
      navigate(focusHref(location, focus));
    },
    [navigate, location, params.focus, params.doc],
  );
  const openDoc = useCallback(
    (projectId: string, path: string) => {
      const base = target.kind === 'docs' || target.kind === 'folder' ? null : focusHref(location, `docs:${projectId}`);
      const from = base ? { pathname: location.pathname, search: new URL(base, 'http://x').search } : location;
      const state: DocPopupState = { roadmapDoc: true };
      navigate(docHref(from, path), { state, preventScrollReset: true });
    },
    [navigate, location, target.kind],
  );
  const closeDoc = useCallback(() => {
    if (pushedByDocPopup(location.state)) navigate(-1);
    else navigate(docHref(location, null), { replace: true, preventScrollReset: true });
  }, [navigate, location]);
  const openDetail = useCallback(
    (identifier: string | null | undefined) => {
      if (identifier) issues.open(identifier);
    },
    [issues],
  );

  /** Bấm một nút: `far` khi bấm ô màu / nhãn nổi ở mức xa (luôn bay tới, không mở chi tiết). */
  const activate = (node: RoadmapNode, far = false) => {
    if (!world) return;
    const projectOf = () => (world.nodes.get(node.id)?.island ?? '').replace(/^docs:/, '');
    switch (node.kind) {
      case 'company':
        goFocus(null);
        return;
      case 'request':
      case 'ticket':
        if (!far && node.id === currentId) openDetail(node.identifier);
        else goFocus(focusOfNode(world, node.id));
        return;
      case 'page':
        if (far) goFocus(node.parentId ?? null);
        else if (node.subtitle) openDoc(projectOf(), node.subtitle);
        return;
      case 'folder':
        goFocus(!far && node.id === currentId ? (parentFocus(world, target) ?? null) : node.id);
        return;
      default:
        goFocus(focusOfNode(world, node.id));
    }
  };
  const activateRef = useRef(activate);
  activateRef.current = activate;
  const onActivate = useCallback((node: RoadmapNode, far?: boolean) => activateRef.current(node, far), []);

  const up = () => {
    if (!world) return;
    const parent = parentFocus(world, target);
    if (parent !== undefined) goFocus(parent);
  };

  // Phím: Esc ra một mức, 0 về toàn cảnh, Enter mở chi tiết mục đang xem. Bỏ qua khi có popup/hộp thoại hay đang gõ.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (overlayOpen() || isEditable(document.activeElement)) return;
    if (popupIssueRef(location.search) || params.doc) return;
    if (e.key === 'Escape') up();
    else if (e.key === '0' && params.view === 'map') goFocus(null);
    else if (e.key === 'Enter' && (target.kind === 'request' || target.kind === 'ticket')) {
      const el = document.activeElement;
      if (el && el !== document.body && el.closest('button, a, [role="button"]')) return;
      openDetail(target.identifier);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Dạng danh sách: cuộn tới mục đang xem.
  useEffect(() => {
    if (params.view !== 'list' || !currentId) return;
    const el = document.querySelector<HTMLElement>(
      `[data-slot="roadmap-list"] [data-roadmap-id="${CSS.escape?.(currentId) ?? currentId}"]`,
    );
    el?.scrollIntoView?.({ block: 'center' });
  }, [params.view, currentId]);

  // ---- Đầu trang ----------------------------------------------------------------------------------------------------
  const crumbs = world ? focusTrail(world, target, tg) : [{ id: 'company', label: company.name, focus: null }];
  const breadcrumb = (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <Fragment key={c.id}>
              {i > 0 ? <BreadcrumbSeparator /> : null}
              <BreadcrumbItem>
                {last ? (
                  <BreadcrumbPage>{c.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={focusHref(location, c.focus)}>{c.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
  const atOverview = target.kind === 'overview' || target.kind === 'missing';
  const actions = (
    <>
      <Button variant="outline" size="sm" disabled={atOverview} onClick={up} title={t('outHint')}>
        <ArrowLeft aria-hidden />
        {t('out')}
        <span className="hidden sm:inline-flex">
          <Kbd>{t('keys.esc')}</Kbd>
        </span>
      </Button>
      <Button variant="outline" size="sm" disabled={atOverview} onClick={() => goFocus(null)} title={t('overviewHint')}>
        <Scan aria-hidden />
        {t('overview')}
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
    params.doc && data.docProject ? (
      <RoadmapDocReader
        companyPrefix={company.issuePrefix}
        projectId={data.docProject}
        path={params.doc}
        page={data.page}
        tree={data.docTree}
        onOpen={(to) => navigate(docHref(location, to), { replace: true, state: location.state })}
        onClose={closeDoc}
      />
    ) : null;

  // Chỗ đang xem cho trình đọc màn hình.
  const focusNode = currentId ? world?.nodes.get(currentId)?.node : null;
  const live = !world
    ? ''
    : atOverview
      ? t('live.overview', { name: company.name })
      : t('live.at', { name: crumbs.at(-1)?.label ?? '' });

  const loadError =
    (visible.error && { message: visible.error.message, retry: visible.retry }) ||
    (projects.error && { message: projects.error.message, retry: () => void projects.refetch() }) ||
    (data.roadmapQuery.error && {
      message: data.roadmapQuery.error.message,
      retry: () => void data.roadmapQuery.refetch(),
    });

  let body: ReactNode;
  if (visible.ready && visible.restricted && projects.data && projects.data.length === 0) {
    body = <EmptyState title={t('common:access.noProjectsYet')} description={t('common:access.noProjectsYetHint')} />;
  } else if (loadError && !world) {
    body = (
      <ErrorState
        title={t('loadFailed')}
        message={loadError.message}
        retryLabel={t('common:action.retry')}
        onRetry={loadError.retry}
      />
    );
  } else if (!world) {
    body = <RoadmapWorldSkeleton />;
  } else if (world.islands.length === 0) {
    body = (
      <EmptyState
        title={t('emptyWorld.title')}
        description={t('emptyWorld.hint')}
        action={
          <Button variant="outline" asChild>
            <Link to={`/${encodeURIComponent(company.issuePrefix)}/issues`}>{t('emptyWorld.action')}</Link>
          </Button>
        }
      />
    );
  } else {
    const focusCard =
      focusNode && (focusNode.kind === 'request' || focusNode.kind === 'ticket') ? (
        <RoadmapFocusCard
          node={focusNode}
          openLabel={t('openDetail')}
          shortcut={t('keys.enter')}
          onOpen={() => openDetail(focusNode.identifier)}
        />
      ) : null;
    body = (
      <div className="flex flex-col gap-3">
        {target.kind === 'missing' ? (
          <Alert variant="warning" title={t('notFound')}>
            {t('notFoundHint')}
          </Alert>
        ) : null}
        {roadmap?.truncated ? <Alert variant="warning" title={t('truncated', { limit: NODE_LIMIT })} /> : null}
        {params.view === 'list' ? (
          <RoadmapList
            label={t('listLabel')}
            center={atOverview ? { ...world.company.node, current: true } : world.company.node}
            items={worldListItems(world, currentId ?? (target.kind === 'project' ? target.id : null))}
            empty={t('empty.default')}
            onOpen={(node) => {
              if (node.kind === 'request' || node.kind === 'ticket') openDetail(node.identifier);
              else activate(node);
            }}
          />
        ) : (
          <RoadmapWorldCanvas
            world={world}
            focusKey={`${params.focus ?? ''}#${nonce}`}
            focus={worldFocusOf(target)}
            currentId={currentId}
            activeCluster={'cluster' in target ? target.cluster : null}
            activeIsland={
              target.kind === 'request' || target.kind === 'docs'
                ? target.id
                : target.kind === 'ticket' || target.kind === 'folder'
                  ? target.island
                  : null
            }
            onActivate={onActivate}
            onOverview={() => goFocus(null)}
            labels={{
              canvas: t('canvasLabel'),
              hint: t(`hint.${target.kind === 'missing' ? 'overview' : target.kind}`),
              overview: t('overview'),
              minimap: t('minimap'),
              lod: [t('lod.blocks'), t('lod.labels'), t('lod.cards')],
            }}
            overlay={focusCard}
            live={live}
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
