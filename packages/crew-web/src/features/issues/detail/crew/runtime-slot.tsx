// crew: tự dựng
import type { Issue } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { api, queryKeys, type RuntimeDecision } from '@/api';
import { Badge, PropertyEmpty, PropertyRow, PropertySection } from '@/ds';
import { formatDateTime, useT } from '@/i18n';

const KNOWN_RUNTIMES = ['claude_local', 'codex_local', 'opencode_local'];

/**
 * Khối "Runtime" ở cột Thuộc tính: các quyết định chọn runtime và tự chuyển runtime của issue (data
 * `crew.runtimeDecisions`, mới nhất trước, tối đa 50 dòng). Không có quyết định nào thì không hiện gì.
 */
export function RuntimeSlot({ issue }: { issue: Issue }) {
  const { t, lang } = useT('issues');
  const companyId = issue.companyId;
  const query = useQuery({
    queryKey: queryKeys.crew('crew.runtimeDecisions', { companyId, issueId: issue.id }),
    queryFn: () => api.crew.runtimeDecisions(companyId, issue.id),
  });
  const title = t('crew.runtime.title');
  const rows = query.data ?? [];

  if (query.error) {
    return (
      <PropertySection title={title}>
        <PropertyEmpty>
          {t('crew.runtime.failed')}: {query.error.message}
        </PropertyEmpty>
      </PropertySection>
    );
  }
  if (!rows.length) return null;

  const runtimeName = (r: string | null) =>
    r ? (KNOWN_RUNTIMES.includes(r) ? t(`crew.runtime.name.${r}`) : r) : t('crew.runtime.unknown');
  const agentName = (name: string | null) => name ?? t('crew.runtime.unknown');

  const line = (d: RuntimeDecision) => {
    if (d.kind === 'select') return `${agentName(d.toAgentName)} · ${runtimeName(d.toRuntime)}`;
    const target = d.kind === 'fallback' ? ` → ${agentName(d.toAgentName)} · ${runtimeName(d.toRuntime)}` : '';
    return `${agentName(d.fromAgentName)} · ${runtimeName(d.fromRuntime)}${target}`;
  };
  const detail = (d: RuntimeDecision) =>
    [
      d.model,
      d.complexity ? t('crew.runtime.complexity', { complexity: d.complexity }) : null,
      d.trigger ? t(`crew.runtime.trigger.${d.trigger}`) : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <PropertySection title={title}>
      {rows.map((d) => (
        <div key={d.id} data-testid="runtime-decision">
          <PropertyRow label={t(`crew.runtime.role.${d.role}`)} wrap>
            <Badge
              variant={d.kind === 'fallback_refused' ? 'destructive' : d.kind === 'fallback' ? 'secondary' : 'outline'}
            >
              {t(`crew.runtime.kind.${d.kind}`)}
            </Badge>
            <span>{line(d)}</span>
            {detail(d) ? <PropertyEmpty>{detail(d)}</PropertyEmpty> : null}
            <PropertyEmpty>{d.reason}</PropertyEmpty>
            <PropertyEmpty>{formatDateTime(d.decidedAt, lang)}</PropertyEmpty>
          </PropertyRow>
        </div>
      ))}
    </PropertySection>
  );
}
