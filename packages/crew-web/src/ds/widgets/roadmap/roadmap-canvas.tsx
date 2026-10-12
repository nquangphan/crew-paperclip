// crew: tự dựng
import { Component, lazy, type ReactNode, Suspense } from 'react';
import { useT } from '@/i18n';
import { ErrorState } from '../../components/error-state';
import { Spinner } from '../../components/spinner';
import type { RoadmapLevel, RoadmapNode } from './roadmap-types';

export type {
  RoadmapEdge,
  RoadmapEdgeKind,
  RoadmapLevel,
  RoadmapNode,
  RoadmapNodeKind,
  RoadmapPoint,
} from './roadmap-types';

// @xyflow/react nặng nên chỉ nạp khi trang Roadmap hiện bản đồ (chung chunk với bản đồ yêu cầu Crew).
const RoadmapFlow = lazy(() => import('./roadmap-flow'));

/** Hướng chuyển tầng: vào sâu (thu ra để lộ tầng mới), lùi ra (thu ra từ nút vừa rời), hay không hiệu ứng. */
export type RoadmapDirection = 'in' | 'out' | 'none';

interface RoadmapCanvasProps {
  level: RoadmapLevel;
  /** Khóa của tầng đang xem; đổi khóa thì chạy chuyển động camera. Cập nhật dữ liệu cùng khóa không chạy lại. */
  levelKey: string;
  direction: RoadmapDirection;
  /** Khi lùi tầng: id nút vừa rời (camera bắt đầu ở đó, focus trả về đó). */
  focusId?: string | null;
  /** Bấm một nút (sau khi camera phóng vào nếu là nút đi sâu được). */
  onOpen: (node: RoadmapNode) => void;
  labels: { canvas: string; hint?: string };
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

/** Bản đồ Roadmap: tâm ở giữa, nút con tỏa tròn, phóng to/thu nhỏ khi đổi tầng. */
function RoadmapCanvas(props: RoadmapCanvasProps) {
  const { t } = useT();
  return (
    <CanvasBoundary fallback={<ErrorState title={t('roadmap.loadFailed')} />}>
      <Suspense fallback={<Spinner />}>
        <RoadmapFlow {...props} />
      </Suspense>
    </CanvasBoundary>
  );
}

export type { RoadmapCanvasProps };
export { RoadmapCanvas };
