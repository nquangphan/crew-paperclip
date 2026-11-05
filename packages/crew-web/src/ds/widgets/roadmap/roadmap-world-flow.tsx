// crew: tự dựng
// Phần nặng của Roadmap một trang (nạp lười): một bản đồ xyflow chứa cả công ty. Thẻ, dây và chuyển động dùng chung với
// bản đồ Crew ở trang issue (`roadmap-flow-parts`). Mức chi tiết theo độ phóng (`worldLod`):
//   0 ô màu   : nút tròn công ty/project (giữ cỡ tối thiểu trên màn hình) + mỗi việc một ô màu trên vài <path> SVG gộp
//               theo màu; chỉ dây trục.
//   1 nhãn    : thêm nhãn nổi của đảo trong khung (tối đa PLATE_LIMIT), dây cha-con trong đảo mờ.
//   2 thẻ     : thẻ đầy đủ (xyflow chỉ vẽ nút trong khung: onlyRenderVisibleElements), dây cha-con/chặn/vòng sửa, lớp
//               chạy trên dây trong khung (tối đa FLOW_LIMIT).
// Camera chỉ bay khi `focusKey` đổi (bấm, Back, deep link), dữ liệu live không làm camera nhảy. Độ phóng, mức chi tiết,
// nhãn độ phóng và khung trên bản đồ thu nhỏ cập nhật qua biến CSS / thuộc tính DOM, không render lại React mỗi khung hình;
// React chỉ render lại khi đổi mức chi tiết hoặc khi camera dừng (để cập nhật nhãn nổi và dây chạy trong khung).
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  type Edge,
  MarkerType,
  type Node,
  type NodeProps,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStoreApi,
  ViewportPortal,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Scan } from 'lucide-react';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { cn } from '../../cn';
import { StatusGlyph } from '../status-glyph';
import {
  cssEscape,
  EDGE_MARKER_COLOR,
  EDGE_TYPES,
  type EdgeData,
  edgePath,
  FlowNode,
  motionMs,
  type NodeBox,
  type NodeData,
  useColorMode,
  useReducedMotion,
} from './roadmap-flow-parts';
import { RoadmapLegend } from './roadmap-legend';
import { RoadmapNodeButton, roadmapToneVar } from './roadmap-node';
import type { RoadmapNode } from './roadmap-types';
import {
  blockPaths,
  cardsInView,
  containsBox,
  nodeAtPoint,
  padBox,
  platesInView,
  runningInView,
  viewBoxOf,
  WORLD_LOD_ZOOM,
  type WorldBox,
  type WorldLod,
  type WorldNode,
  worldFocusView,
  worldLod,
} from './roadmap-world';
import type { RoadmapWorldCanvasProps } from './roadmap-world-canvas';

/** Chừa chỗ cho gợi ý và thẻ đang xem (trên), nút điều khiển (phải). */
const PADDING = { top: 52, right: 64, bottom: 24, left: 24 } as const;
/** Nhãn nổi tối đa cùng lúc; lớp chạy trên dây tối đa cùng lúc. */
const PLATE_LIMIT = 80;
const FLOW_LIMIT = 30;
/** Thẻ DOM tối đa ở mức thẻ đầy đủ và khung đệm (nửa khung mỗi phía). */
const CARD_LIMIT = 120;
const CARD_PAD = 0.5;
/** Deep link: mở toàn cảnh rồi bay vào mục sau một nhịp. */
const DEEP_LINK_DELAY = 250;
const FOCUS_TRIES = 60;
const NARROW = 640;
/** ease-out-expo (`--motion-ease-out-expo`) cho camera. */
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

const box = (n: WorldNode): NodeBox => ({ c: { x: n.x, y: n.y }, w: n.w, h: n.h });

interface OrbData extends Record<string, unknown> {
  node: RoadmapNode;
  faded: boolean;
  onActivate: (node: RoadmapNode) => void;
}

/**
 * Nút tròn công ty/project: lớn lên khi thu nhỏ để không nhỏ hơn cỡ đọc được trên màn hình (`--rm-orb-min` chia độ
 * phóng hiện tại `--rm-zoom`). Project neo đáy để lớn lên phía trên, không che hàng đảo đầu tiên.
 */
function OrbNode({ data }: NodeProps<Node<OrbData>>) {
  const project = data.node.kind === 'project';
  return (
    <div
      className="roadmap-world-orb"
      style={{ transformOrigin: project ? '50% 100%' : '50% 50%' } as CSSProperties}
      data-orb={data.node.kind}
    >
      <RoadmapNodeButton
        node={data.node}
        center={false}
        faded={data.faded}
        onActivate={() => data.onActivate(data.node)}
      />
    </div>
  );
}

const WORLD_NODE_TYPES = { roadmap: FlowNode, orb: OrbNode };

function plateLabel(level: WorldNode['node'], running: number, t: ReturnType<typeof useT>['t']) {
  if (level.kind === 'docs')
    return { title: `${t('roadmap.docs')} · ${t('roadmap.meta.pages', { count: level.total ?? 0 })}` };
  const status = level.status ? t(`status.${level.status}`, { defaultValue: level.status }) : '';
  const parts = [status, t('roadmap.world.tasks', { done: level.done ?? 0, total: level.total ?? 0 })];
  if (running) parts.push(t('roadmap.world.running', { count: running }));
  return { title: `${level.identifier} · ${level.title}`, sub: parts.join(' · ') };
}

/** Chữ trên chip "độ phóng · mức". */
const chipText = (k: number, label: string | undefined) => `${Math.round(k * 100)}% · ${label ?? ''}`;

function WorldFlow({
  world,
  focusKey,
  focus,
  currentId,
  activeCluster,
  activeIsland,
  onActivate,
  onOverview,
  labels,
  overlay,
  live,
}: RoadmapWorldCanvasProps) {
  const { t } = useT();
  const rf = useReactFlow();
  const store = useStoreApi();
  const wrap = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLSpanElement>(null);
  const miniView = useRef<SVGRectElement>(null);
  const colorMode = useColorMode(wrap);
  const reduced = useReducedMotion();
  const [lod, setLod] = useState<WorldLod>(0);
  const lodRef = useRef<WorldLod | null>(null);
  const [view, setView] = useState<WorldBox | null>(null);
  // Vùng vẽ thẻ DOM ở mức thẻ đầy đủ: khung nhìn + nửa khung đệm mỗi phía. Chỉ đổi khi camera ra khỏi vùng (kéo xa) hoặc
  // khi bắt đầu bay tới đích mới (vùng của đích), nên kéo/cuộn trong vùng không render lại React.
  const [cardView, setCardView] = useState<WorldBox | null>(null);
  const cardViewRef = useRef<WorldBox | null>(null);
  const flying = useRef(false);
  /** Thế hệ chuyến bay: chuyến bị chuyến sau ngắt không được hạ cờ `flying` của chuyến sau. */
  const flight = useRef(0);
  const setCards = useCallback((b: WorldBox) => {
    cardViewRef.current = b;
    setCardView(b);
  }, []);
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;
  const activate = useCallback((node: RoadmapNode, far?: boolean) => onActivateRef.current(node, far), []);

  // Nhãn mức đọc qua ref: người gọi truyền mảng mới mỗi lần render, không được làm effect camera đăng ký lại store.
  const lodLabels = useRef(labels.lod);
  lodLabels.current = labels.lod;

  // Nhãn mức đổi (đổi ngôn ngữ) khi camera đứng yên: chỉ ghi lại chữ trên chip, không đăng ký lại store.
  const lodText = labels.lod.join('\n');
  useEffect(() => {
    const level = lodRef.current;
    if (!chip.current || level === null) return;
    chip.current.textContent = chipText(store.getState().transform[2], lodText.split('\n')[level]);
  }, [lodText, store]);

  const readView = useCallback(() => {
    const s = store.getState();
    setView(viewBoxOf(s.transform, { width: s.width, height: s.height }));
  }, [store]);

  // Độ phóng → biến CSS, nhãn "độ phóng · mức", khung trên bản đồ thu nhỏ: cập nhật DOM trực tiếp mỗi khung hình.
  useEffect(() => {
    let last: readonly number[] | null = null;
    const apply = (s: ReturnType<typeof store.getState>) => {
      if (s.transform === last) return;
      last = s.transform;
      const [tx, ty, k] = s.transform;
      const el = wrap.current;
      if (!el) return;
      el.style.setProperty('--rm-zoom', String(k));
      el.style.setProperty('--rm-orb-min', s.width < NARROW ? '0.5' : '0.9');
      const next = worldLod(k, lodRef.current);
      if (next !== lodRef.current) {
        lodRef.current = next;
        el.dataset.lod = String(next);
        setLod(next);
        setView(viewBoxOf(s.transform, { width: s.width, height: s.height }));
      }
      if (next === 2 && !flying.current) {
        const vb = viewBoxOf(s.transform, { width: s.width, height: s.height });
        if (!cardViewRef.current || !containsBox(cardViewRef.current, vb)) setCards(padBox(vb, CARD_PAD));
      }
      if (chip.current) chip.current.textContent = chipText(k, lodLabels.current[next]);
      const r = miniView.current;
      if (r) {
        r.setAttribute('x', String(-tx / k));
        r.setAttribute('y', String(-ty / k));
        r.setAttribute('width', String(s.width / k));
        r.setAttribute('height', String(s.height / k));
      }
    };
    apply(store.getState());
    return store.subscribe(apply);
  }, [store, setCards]);

  // ---- Nút và cạnh -----------------------------------------------------------------------------------------------------
  const lit = focus.kind !== 'overview';
  const fadedOf = useCallback(
    (n: WorldNode) =>
      lit &&
      n.cluster !== null &&
      (n.cluster !== activeCluster || (activeIsland !== null && n.island !== null && n.island !== activeIsland)),
    [lit, activeCluster, activeIsland],
  );
  const orbs = useMemo<Node<OrbData>[]>(
    () =>
      [world.company, ...world.clusters.map((c) => world.nodes.get(c.id) as WorldNode)].map((n) => ({
        id: n.node.id,
        type: 'orb',
        position: { x: n.x, y: n.y },
        initialWidth: n.w,
        initialHeight: n.h,
        data: { node: n.node, faded: fadedOf(n), onActivate: activate },
        draggable: false,
        selectable: false,
        focusable: false,
        connectable: false,
        zIndex: 10,
      })),
    [world, fadedOf, activate],
  );
  const cardNodes = useMemo(
    () => (lod === 2 && cardView ? cardsInView(world, cardView, CARD_LIMIT, currentId) : []),
    [world, lod, cardView, currentId],
  );
  const cardIds = useMemo(() => new Set(cardNodes.map((n) => n.node.id)), [cardNodes]);
  const cards = useMemo<Node<NodeData>[]>(() => {
    const out: Node<NodeData>[] = [];
    for (const n of cardNodes) {
      const node = n.node.id === currentId ? { ...n.node, current: true } : n.node;
      out.push({
        id: n.node.id,
        type: 'roadmap',
        position: { x: n.x, y: n.y },
        initialWidth: n.w,
        initialHeight: n.h,
        data: { node, center: n.center, dimmed: false, faded: fadedOf(n), enter: null, onActivate: activate },
        draggable: false,
        selectable: false,
        focusable: false,
        connectable: false,
      });
    }
    return out;
  }, [cardNodes, currentId, fadedOf, activate]);
  const nodes = useMemo(() => [...cards, ...orbs], [cards, orbs]);

  const flowIds = useMemo(
    () => (lod === 2 && !reduced && view ? runningInView(world, view, FLOW_LIMIT) : new Set<string>()),
    [world, lod, reduced, view],
  );
  const edges = useMemo<Edge<EdgeData>[]>(() => {
    if (!cardIds.size) return [];
    return world.edges.flatMap((edge) => {
      const a = world.nodes.get(edge.source);
      const b = world.nodes.get(edge.target);
      if (!a || !b || !cardIds.has(edge.source) || !cardIds.has(edge.target)) return [];
      return [
        {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: edge.kind,
          markerEnd: EDGE_MARKER_COLOR[edge.kind]
            ? { type: MarkerType.ArrowClosed, color: EDGE_MARKER_COLOR[edge.kind], width: 16, height: 16 }
            : undefined,
          data: {
            enterDelay: null,
            running: world.running.has(edge.id),
            flow: flowIds.has(edge.id),
            topDown: true,
            boxes: { a: box(a), b: box(b) },
            faded: fadedOf(a),
          },
          focusable: false,
          selectable: false,
          ariaRole: 'presentation',
          domAttributes: { 'aria-hidden': true, 'aria-label': undefined, 'aria-roledescription': undefined },
        },
      ];
    });
  }, [world, cardIds, flowIds, fadedOf]);

  // ---- Lớp vẽ tĩnh (dây trục, ô màu, dây mờ trong đảo) và nhãn nổi ----------------------------------------------------
  // Ô màu: mọi nút chưa vẽ thành thẻ (ở mức thẻ đầy đủ, phần ngoài vùng thẻ vẫn thấy được khi kéo).
  const blocks = useMemo(() => blockPaths(world, cardIds), [world, cardIds]);
  const trunks = useMemo(
    () =>
      world.trunks.flatMap((tr) => {
        const a = world.nodes.get(tr.source);
        const b = world.nodes.get(tr.target);
        return a && b ? [{ ...tr, d: edgePath('parent', box(a), box(b), false, true) }] : [];
      }),
    [world],
  );
  const faint = useMemo(
    () =>
      world.edges
        .filter((e) => e.kind === 'parent')
        .map((e) => {
          const a = world.nodes.get(e.source);
          const b = world.nodes.get(e.target);
          return a && b ? edgePath('parent', box(a), box(b), false, true) : '';
        })
        .join(' '),
    [world],
  );
  const plates = useMemo(() => (lod === 1 && view ? platesInView(world, view, PLATE_LIMIT) : []), [world, lod, view]);
  const runningIn = useMemo(() => {
    const out = new Map<string, number>();
    for (const n of world.nodes.values()) {
      if (n.island && !n.center && n.node.status === 'in_progress') out.set(n.island, (out.get(n.island) ?? 0) + 1);
    }
    return out;
  }, [world]);

  // ---- Camera ----------------------------------------------------------------------------------------------------------
  const fly = useCallback(
    (target: { x: number; y: number; zoom: number }, instant = false) => {
      const k = store.getState().transform[2];
      const duration =
        instant || reduced
          ? 0
          : target.zoom >= k
            ? motionMs('--roadmap-zoom-in', 450)
            : motionMs('--roadmap-zoom-out', 650);
      const st = store.getState();
      if (target.zoom >= WORLD_LOD_ZOOM[1] - 0.02 && st.width) {
        const w = st.width / target.zoom;
        const h = st.height / target.zoom;
        setCards(padBox({ x: target.x - w / 2, y: target.y - h / 2, w, h }, CARD_PAD));
      }
      const gen = ++flight.current;
      flying.current = duration > 0;
      return rf.setCenter(target.x, target.y, { zoom: target.zoom, duration, ease: easeOutExpo }).finally(() => {
        if (flight.current === gen) flying.current = false;
      });
    },
    [rf, store, reduced, setCards],
  );
  // xyflow sẵn sàng (panzoom đã gắn, đã đo khung) thì mới đặt camera lần đầu.
  const [ready, setReady] = useState(false);
  const [placed, setPlaced] = useState(false);
  const shownKey = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  /** Vòng rAF đang đưa focus bàn phím tới mục đang xem; chỗ lấy nét mới hay unmount thì hủy. */
  const focusRaf = useRef(0);
  /** Còn gắn trên trang: chuyến bay xong muộn sau unmount không đặt lại vòng rAF. */
  const mounted = useRef(false);
  // Khai báo trước effect camera để cờ đã bật khi effect đó chạy lần đầu.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(timer.current);
      window.cancelAnimationFrame(focusRaf.current);
    };
  }, []);
  useEffect(() => {
    if (!ready || shownKey.current === focusKey) return;
    const first = shownKey.current === null;
    shownKey.current = focusKey;
    window.clearTimeout(timer.current);
    window.cancelAnimationFrame(focusRaf.current);
    const st = store.getState();
    const s = {
      width: st.width || wrap.current?.clientWidth || 0,
      height: st.height || wrap.current?.clientHeight || 0,
    };
    const target = worldFocusView(world, focus, s, PADDING);
    const key = focusKey;
    const focusEl = () => {
      // Chuyến bay cũ xong muộn sau khi đã lấy nét chỗ khác: không giành focus về mục cũ.
      if (!mounted.current || shownKey.current !== key) return;
      window.cancelAnimationFrame(focusRaf.current);
      let tries = 0;
      const id = currentId ?? world.company.node.id;
      const step = () => {
        const el = wrap.current?.querySelector<HTMLElement>(`[data-roadmap-id="${cssEscape(id)}"]`);
        if (el && document.activeElement !== el) el.focus({ preventScroll: true });
        if (document.activeElement !== el && ++tries < FOCUS_TRIES)
          focusRaf.current = window.requestAnimationFrame(step);
      };
      focusRaf.current = window.requestAnimationFrame(step);
    };
    if (first) {
      void fly(worldFocusView(world, { kind: 'overview' }, s, PADDING), true);
      setPlaced(true);
      readView();
      if (focus.kind === 'overview') {
        focusEl();
        return;
      }
      timer.current = window.setTimeout(
        () =>
          void fly(target).then(() => {
            readView();
            focusEl();
          }),
        reduced ? 0 : DEEP_LINK_DELAY,
      );
      return;
    }
    void fly(target).then(() => {
      readView();
      focusEl();
    });
  }, [ready, focusKey, focus, world, currentId, fly, readView, reduced, store]);

  // Bấm vào nền ở mức xa: trúng ô của một việc thì bay thẳng tới việc đó.
  const onPaneClick = useCallback(
    (e: React.MouseEvent) => {
      if (lodRef.current === 2) return;
      const hit = nodeAtPoint(world, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      if (hit) activate(hit.node, true);
    },
    [rf, world, activate],
  );

  const showMini = focus.kind !== 'overview' || (wrap.current?.clientWidth ?? NARROW) < NARROW;
  const b = world.bounds;
  const minimapClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const svg = e.currentTarget.querySelector('svg');
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const s = Math.min(r.width / b.w, r.height / b.h);
    const ox = (r.width - b.w * s) / 2;
    const oy = (r.height - b.h * s) / 2;
    const k = store.getState().transform[2];
    void fly({ x: b.x + (e.clientX - r.left - ox) / s, y: b.y + (e.clientY - r.top - oy) / s, zoom: k });
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={wrap}
        data-slot="roadmap-canvas"
        data-world=""
        data-lod={lod}
        data-focus={focusKey}
        data-camera={placed ? 'placed' : 'pending'}
        style={
          {
            '--rm-orb-cap': world.orbCap.project,
            '--rm-company-cap': world.orbCap.company,
          } as CSSProperties
        }
        className="roadmap-canvas roadmap-world relative h-[calc(100dvh-15rem)] min-h-[24rem] w-full overflow-hidden rounded-xl border"
      >
        <ReactFlow
          className="roadmap-flow"
          aria-label={labels.canvas}
          nodes={nodes}
          edges={edges}
          nodeTypes={WORLD_NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          nodeOrigin={[0.5, 0.5]}
          colorMode={colorMode}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          autoPanOnNodeFocus={false}
          zoomOnDoubleClick={false}
          onlyRenderVisibleElements
          onInit={() => setReady(true)}
          onMoveEnd={readView}
          onPaneClick={onPaneClick}
          minZoom={0.005}
          maxZoom={3}
          proOptions={{ hideAttribution: true }}
          ariaLabelConfig={{
            'controls.ariaLabel': t('roadmap.controls.label'),
            'controls.zoomIn.ariaLabel': t('roadmap.controls.zoomIn'),
            'controls.zoomOut.ariaLabel': t('roadmap.controls.zoomOut'),
            'controls.fitView.ariaLabel': t('roadmap.controls.fit'),
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--roadmap-dot)" />
          <ViewportPortal>
            <svg
              aria-hidden
              width={1}
              height={1}
              className="roadmap-world-layer pointer-events-none absolute top-0 left-0 overflow-visible"
            >
              {blocks.length
                ? blocks.map((p) => (
                    <path
                      key={p.tone}
                      d={p.d}
                      fill={p.tone}
                      data-block-tone={p.tone}
                      className={cn('roadmap-world-block', p.running && 'roadmap-world-block-running')}
                    />
                  ))
                : null}
              {lod === 1 ? <path d={faint} data-edge-kind="parent" className="roadmap-edge opacity-35" /> : null}
              {trunks.map((tr) =>
                lod === 2 && tr.island !== null && tr.island !== activeIsland ? null : (
                  <path
                    key={tr.id}
                    d={tr.d}
                    data-edge-kind="parent"
                    data-trunk=""
                    className={cn('roadmap-edge', lit && tr.cluster !== activeCluster && 'opacity-25')}
                  />
                ),
              )}
            </svg>
            {plates.map((island) => {
              const root = island.level.center;
              const label = plateLabel(root, runningIn.get(island.id) ?? 0, t);
              return (
                <div
                  key={island.id}
                  className="absolute"
                  style={{ left: island.box.x, top: island.box.y, '--rm-w': island.box.w } as CSSProperties}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    data-plate={island.id}
                    aria-label={label.sub ? `${label.title}, ${label.sub}` : label.title}
                    onClick={() => activate(root, true)}
                    style={
                      {
                        '--tone': root.kind === 'docs' ? 'var(--primary)' : roadmapToneVar(root.status),
                      } as CSSProperties
                    }
                    className={cn(
                      'roadmap-world-plate roadmap-card pointer-events-auto absolute bottom-0 left-0 flex cursor-pointer flex-col gap-0.5 rounded-lg px-2.5 py-1.5 text-left',
                      lit &&
                        (island.cluster !== activeCluster || (activeIsland && island.id !== activeIsland)) &&
                        'opacity-35',
                    )}
                  >
                    <span className="truncate text-[12px] leading-4 font-semibold text-card-foreground">
                      {label.title}
                    </span>
                    {label.sub ? (
                      <span className="flex min-w-0 items-center gap-1 truncate text-[11px] leading-4 text-muted-foreground">
                        {root.status ? <StatusGlyph status={root.status} size="sm" color="var(--tone)" /> : null}
                        {label.sub}
                      </span>
                    ) : null}
                  </button>
                </div>
              );
            })}
          </ViewportPortal>
          <Controls showInteractive={false} showFitView={false} position="bottom-right">
            <ControlButton onClick={onOverview} title={labels.overview} aria-label={labels.overview}>
              <Scan aria-hidden />
            </ControlButton>
          </Controls>
        </ReactFlow>
        {labels.hint ? (
          <p className="pointer-events-none absolute top-2.5 left-2.5 z-10 hidden max-w-[55%] truncate rounded-full border bg-(--roadmap-card) px-3 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm sm:block">
            {labels.hint}
          </p>
        ) : null}
        <p aria-live="polite" className="sr-only" data-slot="roadmap-live">
          {live}
        </p>
        {overlay ? (
          <div className="absolute top-2.5 right-2.5 z-10 max-w-[min(26rem,calc(100%-1.25rem))]">{overlay}</div>
        ) : null}
        <span
          ref={chip}
          aria-hidden
          data-slot="roadmap-zoom-chip"
          className="pointer-events-none absolute right-14 bottom-4 z-10 rounded-full border bg-(--roadmap-card) px-2.5 py-0.5 text-[11px] text-muted-foreground tabular-nums"
        />
        {showMini ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={labels.minimap}
            data-slot="roadmap-minimap"
            onClick={minimapClick}
            className="absolute bottom-3 left-3 z-10 h-24 w-48 cursor-pointer overflow-hidden rounded-lg border bg-(--roadmap-card) shadow-sm"
          >
            <svg
              aria-hidden
              viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`}
              preserveAspectRatio="xMidYMid meet"
              className="size-full"
            >
              {world.islands.map((i) => (
                <rect
                  key={i.id}
                  x={i.box.x}
                  y={i.box.y}
                  width={i.box.w}
                  height={i.box.h}
                  rx={40}
                  fill={
                    i.level.center.kind === 'docs' ? 'var(--muted-foreground)' : roadmapToneVar(i.level.center.status)
                  }
                  opacity={0.55}
                />
              ))}
              {world.clusters.map((c) => {
                const n = world.nodes.get(c.id) as WorldNode;
                return <circle key={c.id} cx={n.x} cy={n.y} r={160} fill={c.node.color || 'var(--primary)'} />;
              })}
              <rect ref={miniView} className="roadmap-world-minimap-view" rx={20} />
            </svg>
          </button>
        ) : null}
      </div>
      <RoadmapLegend edges={['parent', 'blocks', 'repair']} current />
    </div>
  );
}

function RoadmapWorldFlow(props: RoadmapWorldCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorldFlow {...props} />
    </ReactFlowProvider>
  );
}

export default RoadmapWorldFlow;
