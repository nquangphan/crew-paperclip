// Trang Hướng dẫn (S17): văn bản tĩnh theo ngôn ngữ đang chọn, mục lục, chỗ ảnh minh họa và danh sách tính năng không có.
import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCompany } from '@/app/hooks';
import { MarkdownView, PageHeader } from '@/ds';
import { companyHref } from '@/features/projects/paths';
import { useT } from '@/i18n';
import enMarkdown from './content/guide.en.md?raw';
import viMarkdown from './content/huong-dan.vi.md?raw';
import { type GuideBlock, parseGuide, prefixInternalLinks } from './guide-parse';
import { GuideShot } from './guide-shot';
import { MissingFeaturesSection } from './missing-features-section';

const sectionId = (index: number) => `guide-section-${index + 1}`;

function Blocks({ blocks }: { blocks: GuideBlock[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        const key = `${block.type}-${i}`;
        if (block.type === 'shot') return <GuideShot key={key} id={block.id} />;
        if (block.type === 'missing') return <MissingFeaturesSection key={key} />;
        return <MarkdownView key={key} markdown={block.text} />;
      })}
    </>
  );
}

export function GuidePage() {
  const { t, lang } = useT('guide');
  const { company } = useCompany();
  const navigate = useNavigate();
  const body = useRef<HTMLDivElement>(null);
  const doc = useMemo(
    () =>
      parseGuide(
        prefixInternalLinks(lang === 'en' ? enMarkdown : viMarkdown, (to) => companyHref(company.issuePrefix, to)),
      ),
    [lang, company.issuePrefix],
  );

  // Link nội bộ (đã gắn tiền tố company) chuyển trang trong app, không tải lại.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const onClick = (event: MouseEvent) => {
      const href = (event.target as Element | null)?.closest('a')?.getAttribute('href');
      if (!href?.startsWith('/') || href.startsWith('//') || event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      navigate(href);
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [navigate]);

  const jump = (index: number) => (event: React.MouseEvent) => {
    event.preventDefault();
    document.getElementById(sectionId(index))?.scrollIntoView?.({ behavior: 'smooth' });
  };

  return (
    <>
      <PageHeader title={doc.title} description={t('description')} />
      <div ref={body} className="flex flex-col gap-6">
        <Blocks blocks={doc.intro} />
        <nav aria-label={t('toc')} className="flex flex-col gap-1">
          <strong>{t('toc')}</strong>
          <ol className="flex flex-col gap-1">
            {doc.sections.map((section, i) => (
              <li key={section.title}>
                <a href={`#${sectionId(i)}`} onClick={jump(i)}>
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        {doc.sections.map((section, i) => (
          <section key={section.title} id={sectionId(i)} aria-label={section.title} className="flex flex-col gap-3">
            <MarkdownView markdown={`## ${section.title}`} />
            <Blocks blocks={section.blocks} />
          </section>
        ))}
      </div>
    </>
  );
}
