// crew: tự dựng
import type { Issue } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, queryKeys, useBugFinding } from '@/api';
import { CrewMap, CrewSummary, DocsCheckPanel, ErrorState, StageStrip, stageStripOf } from '@/ds';
import { useT } from '@/i18n';
import { labelledKindOf } from '../../new/kinds';
import { useIssueOpener } from '../../popup/issue-nav';
import { BugFindingSection, withBugFindingDetails } from './bug-finding-panel';

/**
 * Tóm tắt Crew trên đầu trang (S6.1–S6.3): "x/y con xong · giai đoạn · docs", nút Mở/Đóng map; mở ra thì có
 * bản đồ (bấm ô mở issue: trong popup thì thay popup, trên trang đầy đủ thì sang trang đó) và panel kiểm docs. Kiểm docs hỏi theo yêu cầu gốc, như tab Crew của plugin.
 * Issue không thuộc yêu cầu Crew (`not_crew_root`) thì không hiện gì. Ticket tổng code-bf (luồng Bug Finding) có thêm
 * dải bốn giai đoạn và khối Bug Finding (tiến độ lane, finding theo kế hoạch của Trợ Lý) khi đang xem chính ticket tổng.
 */
export function SummarySlot({ issue }: { issue: Issue }) {
  const { t } = useT('issues');
  const { open } = useIssueOpener();
  const [expanded, setExpanded] = useState(false);
  const companyId = issue.companyId;
  const mapQuery = useQuery({
    queryKey: queryKeys.crew('crew.map', { companyId, issueId: issue.id }),
    queryFn: () => api.crew.map(companyId, issue.id),
  });
  const map = mapQuery.data;
  const crew = !!map && !map.diagnostics.includes('not_crew_root');
  const rootId = map?.root.id ?? '';
  const docsQuery = useQuery({
    queryKey: queryKeys.crew('crew.docsCheck', { companyId, issueId: rootId }),
    queryFn: () => api.crew.docsCheck(companyId, rootId),
    enabled: crew,
  });
  // Loại Viết tài liệu / Lập kế hoạch nằm ở nhãn của yêu cầu gốc; đang xem việc con thì đọc gốc (thường đã có trong cache).
  const viewingRoot = rootId === issue.id;
  const rootQuery = useQuery({
    queryKey: queryKeys.issue(rootId),
    queryFn: () => api.issues.get(rootId),
    enabled: crew && !viewingRoot,
  });
  const labelled = labelledKindOf(viewingRoot ? issue.labels : rootQuery.data?.labels);
  const rootKind = labelled === 'docs' || labelled === 'plan' ? labelled : null;
  const bugFindingRoot = crew && viewingRoot && map?.root.kind === 'code-bf';
  const bugFinding = useBugFinding(companyId, rootId, bugFindingRoot);

  if (mapQuery.error) {
    return (
      <ErrorState
        title={t('crew.mapFailed')}
        message={mapQuery.error.message}
        onRetry={() => void mapQuery.refetch()}
      />
    );
  }
  if (!map || !crew) return null;

  const openIssue = (id: string) => {
    const node = map.nodes.find((n) => n.id === id);
    open(node?.identifier ?? id);
  };
  return (
    <div className="flex flex-col gap-2">
      <CrewSummary
        map={map}
        issueId={issue.id}
        docsCheck={docsQuery.data}
        expanded={expanded}
        onToggleMap={() => setExpanded((v) => !v)}
      />
      {bugFindingRoot ? (
        <>
          <StageStrip items={withBugFindingDetails(stageStripOf(map.root.stage, map.root.kind), bugFinding.data, t)} />
          <BugFindingSection companyId={companyId} issueId={rootId} />
        </>
      ) : null}
      {expanded ? (
        <div className="flex flex-col gap-2">
          <CrewMap map={map} currentIssueId={issue.id} onOpenIssue={openIssue} rootKind={rootKind} />
          {docsQuery.error ? (
            <ErrorState title={t('crew.docsFailed')} message={docsQuery.error.message} />
          ) : (
            <DocsCheckPanel result={docsQuery.data} />
          )}
        </div>
      ) : null}
    </div>
  );
}
