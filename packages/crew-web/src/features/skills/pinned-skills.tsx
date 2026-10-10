// Skill ghim (S14.7): skill của bản Superpowers đã ghim trên máy, nạp qua `--plugin-dir`, không phải skill company.
// Khối chỉ đọc: không có nút nào, web không sửa hay xóa được các skill này.
import type { CrewMachine } from '@/api';
import { Badge, MutedText, Section } from '@/ds';
import { useT } from '@/i18n';
import { hasSuperpowersData } from './name-guard';

export function PinnedSkills({ machines }: { machines: readonly CrewMachine[] }) {
  const { t } = useT('skills');
  const reports = machines.map((m) => m.latest);
  const names = [...new Set(reports.flatMap((r) => r.superpowers.skills ?? []))].sort((a, b) => a.localeCompare(b));
  const versions = [...new Set(reports.map((r) => r.superpowers.pinned).filter(Boolean))];

  return (
    <Section title={t('pinned.title')}>
      <MutedText>
        {versions.length ? t('pinned.hintVersion', { version: versions.join(', ') }) : t('pinned.hint')}
      </MutedText>
      {!hasSuperpowersData(reports) ? <MutedText>{t('pinned.unknown')}</MutedText> : null}
      {names.length ? (
        <ul className="flex flex-wrap gap-2">
          {names.map((name) => (
            <li key={name}>
              <Badge variant="outline">{name}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}
