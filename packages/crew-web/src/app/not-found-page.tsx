import { Link } from 'react-router-dom';
import { Button, EmptyState } from '@/ds';
import { useT } from '@/i18n';
import { companyPath } from './routes-util';

/** 404: trong company có nút về Tổng quan; ngoài company về trang đầu. */
export function NotFoundPage({ companyPrefix }: { companyPrefix?: string }) {
  const { t } = useT();
  const to = companyPrefix ? companyPath(companyPrefix, 'dashboard') : '/';
  return (
    <EmptyState
      title={t('notFound.title')}
      description={t('notFound.description')}
      action={
        <Button asChild variant="outline">
          <Link to={to}>{companyPrefix ? t('notFound.toDashboard') : t('notFound.toHome')}</Link>
        </Button>
      }
    />
  );
}
