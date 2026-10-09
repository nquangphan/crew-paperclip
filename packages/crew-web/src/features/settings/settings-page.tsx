// Trang Cài đặt (S18): hồ sơ, ngôn ngữ giao diện, thông tin hệ thống (chỉ đọc).
import { Button, PageHeader, Section } from '@/ds';
import { type Lang, setLanguage, useT } from '@/i18n';
import { ProfileForm } from './profile-form';
import { SystemInfo } from './system-info';

const LANGS: readonly Lang[] = ['vi', 'en'];

export function SettingsPage() {
  const { t, lang } = useT('settings');
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
        <Section title={t('system.title')}>
          <SystemInfo />
        </Section>
      </div>
    </>
  );
}
