// crew: tự dựng
// Roadmap một trang: vỏ nạp lười của bản đồ thế giới (`roadmap-world-flow.tsx`, chung chunk xyflow với bản đồ Crew).
import { ExternalLink } from 'lucide-react';
import { Component, type CSSProperties, lazy, type ReactNode, Suspense } from 'react';
import { useT } from '@/i18n';
import { Kbd } from '../../components/app-frame';
import { Button } from '../../components/button';
import { ErrorState } from '../../components/error-state';
import { Spinner } from '../../components/spinner';
import { StatusGlyph } from '../status-glyph';
import { roadmapToneVar } from './roadmap-node';
import type { RoadmapNode } from './roadmap-types';
import type { RoadmapWorld, WorldFocus } from './roadmap-world';

const RoadmapWorldFlow = lazy(() => import('./roadmap-world-flow'));

interface RoadmapWorldCanvasProps {
  /** Thế giới đã bố cục (`layoutWorld`); nhớ lại giữa các lần render để không tính lại. */
  world: RoadmapWorld;
  /** Khóa chỗ lấy nét (giá trị `?focus=`); đổi khóa thì camera bay tới `focus`. Dữ liệu đổi cùng khóa không dời camera. */
  focusKey: string;
  focus: WorldFocus;
  /** Nút đang xem: viền "đang xem" và nhận focus bàn phím sau khi camera tới. */
  currentId: string | null;
  /** Cụm/đảo đang xem: phần ngoài mờ đi (vẫn bấm được). */
  activeCluster: string | null;
  activeIsland: string | null;
  /** Bấm một nút: thẻ, nút tròn; `far` khi bấm nhãn nổi hay ô màu ở mức xa (bay tới, không mở chi tiết). */
  onActivate: (node: RoadmapNode, far?: boolean) => void;
  /** Nút Toàn cảnh trong cụm điều khiển. */
  onOverview: () => void;
  labels: {
    canvas: string;
    hint?: string;
    overview: string;
    minimap: string;
    /** Tên ba mức chi tiết (ô màu, nhãn yêu cầu, thẻ đầy đủ) cho nhãn độ phóng. */
    lod: readonly [string, string, string];
  };
  /** Phủ góc trên phải bản đồ (thẻ "đang xem" có nút Mở chi tiết). */
  overlay?: ReactNode;
  /** Chỗ đang xem cho trình đọc màn hình (vùng aria-live). */
  live?: string;
}

class CanvasBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Bản đồ một trang: công ty → project → yêu cầu → việc con; bấm để camera bay tới, không đổi trang. */
function RoadmapWorldCanvas(props: RoadmapWorldCanvasProps) {
  const { t } = useT();
  return (
    <CanvasBoundary fallback={<ErrorState title={t('roadmap.loadFailed')} />}>
      <Suspense fallback={<Spinner />}>
        <RoadmapWorldFlow {...props} />
      </Suspense>
    </CanvasBoundary>
  );
}

/** Khung bản đồ lúc đang tải: giữ đúng cỡ khung để bố cục trang không nhảy. */
function RoadmapWorldSkeleton() {
  return (
    <div
      data-slot="roadmap-loading"
      className="roadmap-canvas relative flex h-[calc(100dvh-15rem)] min-h-[24rem] items-center justify-center rounded-xl border"
    >
      <Spinner />
    </div>
  );
}

interface RoadmapFocusCardProps {
  /** Yêu cầu hoặc việc con đang xem. */
  node: RoadmapNode;
  openLabel: string;
  /** Phím tắt mở chi tiết (Enter). */
  shortcut: string;
  onOpen: () => void;
}

/** Thẻ "đang xem" ở góc bản đồ: trạng thái, mã, tiêu đề và nút Mở chi tiết. */
function RoadmapFocusCard({ node, openLabel, shortcut, onOpen }: RoadmapFocusCardProps) {
  return (
    <div
      data-slot="roadmap-focus-card"
      className="roadmap-card flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
      style={{ '--tone': roadmapToneVar(node.status) } as CSSProperties}
    >
      <StatusGlyph status={node.status ?? 'backlog'} size="sm" color="var(--tone)" />
      <span className="shrink-0 font-mono text-xs text-muted-foreground">{node.identifier}</span>
      <strong className="min-w-0 flex-1 truncate font-semibold">{node.title}</strong>
      <Button size="sm" variant="outline" onClick={onOpen}>
        <ExternalLink aria-hidden />
        {openLabel}
        <span className="hidden sm:inline-flex">
          <Kbd>{shortcut}</Kbd>
        </span>
      </Button>
    </div>
  );
}

export type { RoadmapFocusCardProps, RoadmapWorldCanvasProps };
export { RoadmapFocusCard, RoadmapWorldCanvas, RoadmapWorldSkeleton };
