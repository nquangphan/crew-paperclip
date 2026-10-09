// Mục "Vì sao không có nút X": dựng từ MISSING_FEATURES, chữ lấy ở locale `guide`.
import { Badge, MutedText, Section, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ds';
import { useT } from '@/i18n';
import { MISSING_FEATURES, MISSING_GROUPS, type MissingReason } from './missing-features';

const REASON_VARIANT: Record<MissingReason, 'secondary' | 'destructive' | 'outline'> = {
  KD: 'secondary',
  HK: 'destructive',
  CL: 'outline',
  RS: 'outline',
};

export function MissingFeaturesSection() {
  const { t } = useT('guide');
  return (
    <div className="flex flex-col gap-4">
      {MISSING_GROUPS.map((group) => {
        const items = MISSING_FEATURES.filter((f) => f.group === group);
        return (
          <Section key={group} title={t(`groups.${group}`)}>
            <MutedText>{t('missingTable.count', { count: items.length })}</MutedText>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('missingTable.feature')}</TableHead>
                  <TableHead>{t('missingTable.where')}</TableHead>
                  <TableHead>{t('missingTable.reason')}</TableHead>
                  <TableHead>{t('missingTable.note')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id} data-missing-id={item.id}>
                    <TableCell>{t(`missing.${item.id}.feature`)}</TableCell>
                    <TableCell>{t(`missing.${item.id}.where`)}</TableCell>
                    <TableCell>
                      <Badge variant={REASON_VARIANT[item.reason]} title={t(`reasons.${item.reason}.meaning`)}>
                        {t(`reasons.${item.reason}.label`)}
                      </Badge>
                    </TableCell>
                    <TableCell>{t(`missing.${item.id}.note`)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>
        );
      })}
    </div>
  );
}
