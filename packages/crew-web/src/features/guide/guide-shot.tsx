// Một chỗ ảnh minh họa. Có file `img/<id>.png` thì hiện ảnh; chưa có thì hiện khung chỗ kèm chú thích.
import { Card, CardContent, MutedText } from '@/ds';
import { useT } from '@/i18n';
import { GUIDE_SHOTS } from './shots';

const IMAGES = import.meta.glob<string>('./img/*.png', { eager: true, query: '?url', import: 'default' });

export const shotUrl = (id: string): string | undefined => IMAGES[`./img/${id}.png`];

export function GuideShot({ id }: { id: string }) {
  const { t } = useT('guide');
  const caption = t(`shots.${id}`);
  const url = shotUrl(id);
  if (url) {
    return (
      <figure>
        <img src={url} alt={caption} className="w-full" />
        <figcaption>
          <MutedText>{caption}</MutedText>
        </figcaption>
      </figure>
    );
  }
  const route = GUIDE_SHOTS.find((s) => s.id === id)?.route ?? '';
  return (
    <figure data-shot-pending={id}>
      <Card>
        <CardContent className="flex flex-col gap-1">
          <MutedText>{t('shot.pending')}</MutedText>
          <MutedText>{t('shot.screen', { route })}</MutedText>
        </CardContent>
      </Card>
      <figcaption>
        <MutedText>{caption}</MutedText>
      </figcaption>
    </figure>
  );
}
