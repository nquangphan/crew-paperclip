// crew: tự dựng
import type { CrewMap as CrewMapData } from '@crew/paperclip-plugin/shared/map';
import { Component, lazy, type ReactNode, Suspense } from 'react';
import { useT } from '@/i18n';
import { ErrorState } from '../../components/error-state';
import { Spinner } from '../../components/spinner';

// @xyflow/react nặng nên chỉ nạp khi có màn hình hiện bản đồ.
const CrewMapFlow = lazy(() => import('./crew-map-flow'));

interface CrewMapProps {
  map: CrewMapData;
  /** Issue đang xem, được tô viền. */
  currentIssueId?: string;
  onOpenIssue: (issueId: string) => void;
}

class MapBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Bản đồ yêu cầu Crew: cây cha-con kèm cạnh phụ thuộc và vòng sửa. */
function CrewMap(props: CrewMapProps) {
  const { t } = useT();
  return (
    <MapBoundary fallback={<ErrorState title={t('crewMap.loadFailed')} />}>
      <Suspense fallback={<Spinner />}>
        <CrewMapFlow {...props} />
      </Suspense>
    </MapBoundary>
  );
}

export type { CrewMapProps };
export { CrewMap };
