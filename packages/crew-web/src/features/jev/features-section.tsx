// Bốn tính năng Jev đợt 2 (S24.6): chế độ off / shadow / on, thống kê và danh sách ca lệch từng tính năng. Đổi chế độ lưu
// ngay. Công tắc chung tắt thì chế độ chỉ là cấu hình chờ, không có gì chạy.
import { useState } from 'react';
import {
  featureMode,
  JEV_FEATURE_IDS,
  JEV_FEATURE_MODES,
  type JevFeatureId,
  type JevFeatureMode,
  type JevSettings,
  type JudgmentRow,
  type JudgmentStatRow,
} from '@/api';
import {
  Alert,
  Badge,
  Card,
  CardContent,
  CodeBlock,
  EmptyState,
  MutedText,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/ds';
import { formatDateTime, useT } from '@/i18n';
import { confidenceText } from './gate-events-table';
import { sumFeatureStats } from './judge-adapter';
import { settingsInput, useJudgmentStats, useMismatchJudgments, useSaveJevSettings } from './use-jev';

const ms = (v: number | null) => (v === null ? '—' : `${Math.round(v)} ms`);

export function FeaturesSection({ companyId, settings }: { companyId: string; settings: JevSettings }) {
  const { t } = useT('jev');
  const save = useSaveJevSettings(companyId);
  const stats = useJudgmentStats(companyId, true);
  const features = settingsInput(settings).features ?? {};

  const change = (id: JevFeatureId, mode: JevFeatureMode) =>
    save.mutate(settingsInput(settings, { features: { ...features, [id]: mode } }));

  return (
    <div className="flex flex-col gap-4">
      {settings.enabled ? null : <Alert variant="warning">{t('features.masterOff')}</Alert>}
      <MutedText>{t('features.modes')}</MutedText>
      <MutedText>{t('features.statsDays')}</MutedText>
      <ul className="grid gap-3 md:grid-cols-2">
        {JEV_FEATURE_IDS.map((id) => (
          <FeatureCard
            key={id}
            id={id}
            mode={featureMode(features, id)}
            disabled={save.isPending}
            stat={stats.data ? sumFeatureStats(stats.data, id) : null}
            statsReady={stats.isSuccess}
            onChange={(m) => change(id, m)}
          />
        ))}
      </ul>
      {save.error ? (
        <Alert variant="destructive" title={t('features.saveFailed')}>
          {save.error.message}
        </Alert>
      ) : null}
      <MismatchList companyId={companyId} />
    </div>
  );
}

function FeatureCard({
  id,
  mode,
  disabled,
  stat,
  statsReady,
  onChange,
}: {
  id: JevFeatureId;
  mode: JevFeatureMode;
  disabled: boolean;
  stat: JudgmentStatRow | null;
  statsReady: boolean;
  onChange: (mode: JevFeatureMode) => void;
}) {
  const { t } = useT('jev');
  return (
    <li data-testid={`jev-feature-${id}`}>
      <Card>
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <strong className="min-w-0 flex-1">{t(`feature.${id}.name`)}</strong>
            <Select value={mode} disabled={disabled} onValueChange={(v) => onChange(v as JevFeatureMode)}>
              <SelectTrigger size="sm" aria-label={t('features.modeOf', { name: t(`feature.${id}.name`) })}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {JEV_FEATURE_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(`features.mode.${m}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <MutedText>{t(`feature.${id}.hint`)}</MutedText>
          {stat ? (
            <div data-testid={`jev-feature-stats-${id}`} className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{t('features.stat.total', { count: stat.total })}</Badge>
              <Badge variant="secondary">{t('features.stat.mismatch', { count: stat.mismatch })}</Badge>
              <Badge variant="secondary">{t('features.stat.escalated', { count: stat.escalated })}</Badge>
              <Badge variant="secondary">{t('features.stat.errors', { count: stat.errors })}</Badge>
              <Badge variant="outline">
                {t('features.stat.latency', { p50: ms(stat.p50Ms), p95: ms(stat.p95Ms) })}
              </Badge>
            </div>
          ) : (
            <MutedText>{statsReady ? t('features.stat.none') : t('features.stat.unavailable')}</MutedText>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

function MismatchList({ companyId }: { companyId: string }) {
  const { t } = useT('jev');
  const [feature, setFeature] = useState<JevFeatureId>('complexity');
  const rows = useMismatchJudgments(companyId, feature, true);
  return (
    <div className="flex flex-col gap-3">
      <strong>{t('mismatch.title')}</strong>
      <Tabs value={feature} onValueChange={(v) => setFeature(v as JevFeatureId)}>
        <TabsList aria-label={t('mismatch.featureLabel')}>
          {JEV_FEATURE_IDS.map((id) => (
            <TabsTrigger key={id} value={id}>
              {t(`feature.${id}.name`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {rows.isLoading ? <Spinner /> : null}
      {rows.isError ? <MutedText>{t('mismatch.unavailable')}</MutedText> : null}
      {rows.data && rows.data.length === 0 ? (
        <EmptyState title={t('mismatch.empty')} description={t('mismatch.emptyHint')} />
      ) : null}
      {rows.data && rows.data.length > 0 ? (
        <MismatchRows rows={rows.data} caption={t(`feature.${feature}.name`)} />
      ) : null}
    </div>
  );
}

function MismatchRows({ rows, caption }: { rows: readonly JudgmentRow[]; caption: string }) {
  const { t, lang } = useT('jev');
  return (
    <Table aria-label={caption}>
      <TableHeader>
        <TableRow>
          <TableHead>{t('mismatch.col.time')}</TableHead>
          <TableHead>{t('mismatch.col.mode')}</TableHead>
          <TableHead>{t('mismatch.col.baseline')}</TableHead>
          <TableHead>{t('mismatch.col.jev')}</TableHead>
          <TableHead>{t('mismatch.col.confidence')}</TableHead>
          <TableHead>{t('mismatch.col.outcome')}</TableHead>
          <TableHead>{t('mismatch.col.excerpt')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} data-testid="jev-mismatch-row">
            <TableCell>{formatDateTime(r.createdAt, lang)}</TableCell>
            <TableCell>{t(`features.mode.${r.mode}`)}</TableCell>
            <TableCell>{r.baseline ?? '—'}</TableCell>
            <TableCell>{r.jevLabel ?? '—'}</TableCell>
            <TableCell>{confidenceText(r.confidence)}</TableCell>
            <TableCell>{r.ownerOutcome ?? '—'}</TableCell>
            <TableCell>
              {r.inputExcerpt ? <CodeBlock code={r.inputExcerpt} label={t('mismatch.col.excerpt')} /> : '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
