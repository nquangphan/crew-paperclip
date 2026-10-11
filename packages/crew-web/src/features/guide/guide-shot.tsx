// Một hình của hướng dẫn: ảnh chụp theo ngôn ngữ và vai trò, hoặc sơ đồ có nhãn "không phải ảnh chụp". Chưa có file
// thì hiện khung chỗ kèm chú thích (không có thẻ img hỏng).
import { Card, CardContent, DocFigure, MutedText } from '@/ds';
import { type Lang, useT } from '@/i18n';
import type { GuideRole } from './guide-roles';
import { GUIDE_SHOTS, shotFiles } from './shots';

const IMAGES = import.meta.glob<string>('./img/*/*.{webp,svg}', { eager: true, query: '?url', import: 'default' });

/** URL của một hình theo ngôn ngữ và vai trò (`shotFiles`). Thiếu bản tiếng Anh thì dùng bản tiếng Việt. */
export function shotUrl(id: string, lang: Lang, role: GuideRole): string | undefined {
  for (const l of [lang, 'vi'] as const) {
    for (const name of shotFiles(id, role)) {
      const url = IMAGES[`./img/${l}/${name}`];
      if (url) return url;
    }
  }
  return undefined;
}

export function GuideShot({ id, role }: { id: string; role: GuideRole }) {
  const { t, lang } = useT('guide');
  const caption = t(`shots.${id}`);
  const url = shotUrl(id, lang, role);
  const diagram = GUIDE_SHOTS.find((s) => s.id === id)?.kind === 'diagram';
  if (url) {
    return <DocFigure src={url} alt={caption} caption={caption} note={diagram ? t('shot.diagram') : undefined} />;
  }
  return (
    <figure data-shot-pending={id}>
      <Card>
        <CardContent className="flex flex-col gap-1">
          <MutedText>{t('shot.pending')}</MutedText>
        </CardContent>
      </Card>
      <figcaption>
        <MutedText>{caption}</MutedText>
      </figcaption>
    </figure>
  );
}
