// Trang Cài đặt (S18): hồ sơ, ngôn ngữ giao diện, lối vào Cài đặt model (chỉ owner), thông tin hệ thống (chỉ đọc).
import { Link } from 'react-router-dom';
import { useCompany } from '@/app/hooks';
import { companyPath } from '@/app/routes-util';
import { Button, MutedText, PageHeader, Section } from '@/ds';
import { useModelSettings } from '@/features/model-settings';
import { type Lang, setLanguage, useT } from '@/i18n';
import { ProfileForm } from './profile-form';
import { SystemInfo } from './system-info';

const LANGS: readonly Lang[] = ['vi', 'en'];

export function SettingsPage() {
  const { t, lang } = useT('settings');
  const { company } = useCompany();
  const modelSettings = useModelSettings();
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <div className="flex flex-col gap-8">
        <Section title={t('profile.title')}>
          <ProfileForm />
        </Section>
        <Section title={t('language.title')}>
          <div className="flex items-center gap-2">
            {LANGS.map((l) => (
              <Button
                key={l}
                variant={l === lang ? 'secondary' : 'outline'}
                size="sm"
                aria-pressed={l === lang}
                onClick={() => void setLanguage(l)}
              >
                {t(`common:lang.${l}`)}
              </Button>
            ))}
          </div>
        </Section>
        {modelSettings.data?.canEdit ? (
          <Section title={t('models.entry.title')}>
            <MutedText>{t('models.entry.description')}</MutedText>
            <div>
              <Button asChild variant="outline">
                <Link to={companyPath(company.issuePrefix, 'settings/models')}>{t('models.entry.open')}</Link>
              </Button>
            </div>
          </Section>
        ) : null}
        <Section title={t('system.title')}>
          <SystemInfo />
        </Section>
      </div>
    </>
  );
}
