// S0.3: đổi ngôn ngữ VI/EN, lưu ở trình duyệt (localStorage crew.lang), không gọi API.
import { Button } from '@/ds';
import { type Lang, setLanguage, useT } from '@/i18n';

const LANGS: Lang[] = ['vi', 'en'];

export function LanguageSwitch() {
  const { t, lang } = useT();
  return (
    <fieldset aria-label={t('lang.label')} className="flex shrink-0 items-center gap-0">
      {LANGS.map((l) => (
        <Button
          key={l}
          size="xs"
          variant={l === lang ? 'secondary' : 'ghost'}
          aria-pressed={l === lang}
          aria-label={t(`lang.${l}`)}
          onClick={() => void setLanguage(l)}
        >
          {l === 'vi' ? 'VI' : 'EN'}
        </Button>
      ))}
    </fieldset>
  );
}
