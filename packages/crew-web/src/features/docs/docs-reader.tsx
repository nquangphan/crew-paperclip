// Đọc một trang tài liệu: markdown, link nội bộ mở trong trang (không rời UI), link hỏng báo thiếu trang.

import { useEffect, useRef, useState } from 'react';
import type { DocsPage } from '@/api';
import { Alert, Button, MarkdownView, MutedText, Section } from '@/ds';
import { useT } from '@/i18n';

type PageLink = DocsPage['links'][number];

interface DocsReaderProps {
  page: DocsPage;
  onOpen: (path: string) => void;
}

const isOpenable = (link: PageLink): link is PageLink & { toPath: string } =>
  link.status === 'ok' && link.toPath !== null;

export function DocsReader({ page, onOpen }: DocsReaderProps) {
  const { t } = useT('docs');
  const body = useRef<HTMLDivElement>(null);
  const [broken, setBroken] = useState<string | null>(null);

  // Link tương đối trong markdown: đổi sang mở trang trong UI. Link ngoài (có scheme) và neo `#` để mặc định.
  useEffect(() => {
    setBroken(null);
    const el = body.current;
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
        onOpen(link.toPath);
      } else {
        setBroken(href);
      }
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [page, onOpen]);

  const internal = page.links.filter((l) => l.status !== 'external');
  return (
    <Section title={page.title}>
      {broken ? <Alert variant="warning">{t('page.brokenClick', { href: broken })}</Alert> : null}
      <div ref={body}>
        <MarkdownView markdown={page.text} />
      </div>
      {internal.length ? (
        <section aria-label={t('links.title')} className="flex flex-col gap-1">
          <strong>{t('links.title')}</strong>
          <ul className="flex flex-col gap-1">
            {internal.map((link) => (
              <li key={`${link.occurrence}:${link.originalHref}`}>
                {isOpenable(link) ? (
                  <Button variant="link" size="sm" onClick={() => onOpen(link.toPath)}>
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
        </section>
      ) : null}
    </Section>
  );
}
