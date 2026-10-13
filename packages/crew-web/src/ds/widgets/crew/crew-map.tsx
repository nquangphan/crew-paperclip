// crew: tự dựng
// Bản đồ yêu cầu Crew ở trang chi tiết ticket, vẽ bằng canvas Roadmap (cùng thẻ, cạnh, chú giải, chuyển động): yêu
// cầu gốc ở tâm, việc con tỏa quanh, camera thu ra quanh việc đang xem. Canvas nạp lười nên @xyflow/react không vào
// chunk đầu.
import type { CrewMap as CrewMapData } from '@crew/paperclip-plugin/shared/map';
import { useMemo } from 'react';
import { useT } from '@/i18n';
import { RoadmapCanvas } from '../roadmap/roadmap-canvas';
import { CREW_MAP_EDGE_KINDS, crewMapLevel } from './crew-map-level';

interface CrewMapProps {
  map: CrewMapData;
  /** Issue đang xem, được tô viền và là chỗ camera canh vào. */
  currentIssueId?: string;
  onOpenIssue: (issueId: string) => void;
  /** Yêu cầu gốc là loại Viết tài liệu (nhãn `docs`). */
  docs?: boolean;
}

const LEGEND = { edges: CREW_MAP_EDGE_KINDS, current: true } as const;

/** Bản đồ yêu cầu Crew: cây cha-con kèm cạnh phụ thuộc và vòng sửa. Bấm một việc (kể cả gốc) để mở nó. */
function CrewMap({ map, currentIssueId, onOpenIssue, docs = false }: CrewMapProps) {
  const { t, lang } = useT();
  // Nhãn trên thẻ đã dịch sẵn nên dựng lại khi đổi ngôn ngữ.
  // biome-ignore lint/correctness/useExhaustiveDependencies: lang là khóa dịch lại của t.
  const { level, diagnostics } = useMemo(
    () => crewMapLevel(map, currentIssueId, t, { docs }),
    [map, currentIssueId, t, lang, docs],
  );
  return (
    <section aria-label={t('crewMap.label')} data-slot="crew-map" className="flex min-w-0 flex-col gap-2">
      <RoadmapCanvas
        level={level}
        levelKey={`crew-map:${map.root.id}`}
        direction="in"
        focusId={currentIssueId ?? null}
        onOpen={(node) => onOpenIssue(node.id)}
        labels={{ canvas: t('crewMap.label'), hint: t('crewMap.hint') }}
        size="panel"
        legend={LEGEND}
      />
      {diagnostics.length ? (
        <div role="status" className="text-xs text-muted-foreground">
          {diagnostics.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export type { CrewMapProps };
export { CrewMap };
