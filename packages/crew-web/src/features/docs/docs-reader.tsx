// Đọc một trang tài liệu: tiêu đề, commit và giờ nhận bản docs, mục lục thu gọn (màn hẹp), markdown, link nội bộ mở
// trong trang (không rời UI), link hỏng báo thiếu trang, và danh sách liên kết gọn ở cuối bài.

import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import type { DocsPage } from '@/api';
import { Alert, Button, DocAppendix, DocArticle, FloatingNotice, MarkdownView, MutedText } from '@/ds';
import { useT } from '@/i18n';
import { pageTitle, stripLeadingTitle } from './docs-paths';

type PageLink = DocsPage['links'][number];

interface DocsReaderProps {
  page: DocsPage;
  /** Dòng thông tin dưới tiêu đề (commit, giờ nhận). */
  meta: ReactNode;
  /** Mục lục thu gọn đặt đầu bài (màn hẹp). */
  toc: ReactNode;
  /** Khung thân bài: trang đọc heading ở đây để dựng mục lục. */
  bodyRef: RefObject<HTMLDivElement | null>;
  onOpen: (path: string) => void;
}

const isOpenable = (link: PageLink): link is PageLink & { toPath: string } =>
  link.status === 'ok' && link.toPath !== null;

export function DocsReader({ page, meta, toc, bodyRef, onOpen }: DocsReaderProps) {
  const { t } = useT('docs');
  const [broken, setBroken] = useState<string | null>(null);
  const title = pageTitle(page);
  // Hàm mở trang có thể đổi mỗi lần URL đổi; giữ bản mới nhất mà không gắn lại bộ nghe click (gắn lại sẽ xóa cảnh báo).
  const open = useRef(onOpen);
  open.current = onOpen;

  // Link tương đối trong markdown: đổi sang mở trang trong UI. Link ngoài (có scheme) và neo `#` để mặc định.
  useEffect(() => {
    setBroken(null);
    const el = bodyRef.current;
    if (!el) return;
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest('a');
      const href = anchor?.getAttribute('href');
      if (!anchor || !href || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//'))
        return;
      event.preventDefault();
      const link = page.links.find((l) => l.originalHref === href);
      if (link && isOpenable(link)) {
        setBroken(null);
        open.current(link.toPath);
      } else {
        setBroken(href);
      }
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [page, bodyRef]);

  const internal = page.links.filter((l) => l.status !== 'external');
  return (
    <DocArticle title={title} meta={meta}>
      {toc}
      <div ref={bodyRef} className="min-w-0">
        <MarkdownView variant="document" markdown={stripLeadingTitle(page.text, page.title)} />
      </div>
      {internal.length ? (
        <DocAppendix title={t('links.title')}>
          <ul className="flex flex-col gap-1">
            {internal.map((link) => (
              <li key={`${link.occurrence}:${link.originalHref}`} className="flex min-w-0">
                {isOpenable(link) ? (
                  <Button
                    variant="link"
                    size="xs"
                    className="w-full justify-start truncate"
                    onClick={() => onOpen(link.toPath)}
                  >
                    {link.originalHref}
                  </Button>
                ) : link.status === 'missing' ? (
                  <MutedText>{t('links.missing', { href: link.originalHref })}</MutedText>
                ) : (
                  <MutedText>{t('links.unverified', { href: link.originalHref })}</MutedText>
                )}
              </li>
            ))}
          </ul>
        </DocAppendix>
      ) : null}
      {broken ? (
        <FloatingNotice>
          <Alert variant="warning" title={t('page.brokenTitle')}>
            <span className="flex flex-col items-start gap-2">
              <span>{t('page.brokenClick', { href: broken })}</span>
              <Button variant="outline" size="xs" onClick={() => setBroken(null)}>
                {t('common:action.close')}
              </Button>
            </span>
          </Alert>
        </FloatingNotice>
      ) : null}
    </DocArticle>
  );
}
