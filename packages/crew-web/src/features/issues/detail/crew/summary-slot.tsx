// crew: tự dựng
import type { Issue } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { CrewMap, CrewSummary, DocsCheckPanel, ErrorState } from '@/ds';
import { useT } from '@/i18n';

/**
 * Tóm tắt Crew trên đầu trang (S6.1–S6.3): "x/y con xong · giai đoạn · docs", nút Mở/Đóng map; mở ra thì có
 * bản đồ (bấm ô mở issue) và panel kiểm docs. Kiểm docs hỏi theo yêu cầu gốc, như tab Crew của plugin.
 * Issue không thuộc yêu cầu Crew (`not_crew_root`) thì không hiện gì.
 */
export function SummarySlot({ issue }: { issue: Issue }) {
  const { t } = useT('issues');
  const { company } = useCompany();
  const navigate = useNavigate();
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
    navigate(`/${company.issuePrefix}/issues/${node?.identifier ?? id}`);
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
      {expanded ? (
        <div className="flex flex-col gap-2">
          <CrewMap map={map} currentIssueId={issue.id} onOpenIssue={openIssue} />
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
