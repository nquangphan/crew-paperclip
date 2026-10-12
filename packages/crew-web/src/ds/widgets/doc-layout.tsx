// crew: tự dựng
// Bố cục trang tài liệu (trang Hướng dẫn, trang Docs): mục lục dính bên trái, nội dung ở giữa, cột phải tùy chọn; từng
// mục có neo, hình có khung và chú thích. Màn hình nhỏ thì mọi cột xếp chồng thành một.
import type * as React from 'react';
import { cn } from '../cn';

/**
 * Hai cột: mục lục (dính khi cuộn) và nội dung. Có `aside` (ví dụ mục lục "Trên trang này") thì thành ba cột từ mốc
 * `xl`; dưới mốc đó cột phải ẩn, trang tự hiện bản thay thế trong nội dung (DocToc `collapsed`).
 */
function DocLayout({
  nav,
  aside,
  children,
}: {
  nav: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="doc-layout"
      className={cn(
        'grid grid-cols-1 gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]',
        aside ? 'xl:grid-cols-[16rem_minmax(0,1fr)_13rem]' : null,
      )}
    >
      <div className="min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-auto">{nav}</div>
      <div className="flex min-w-0 flex-col gap-10">{children}</div>
      {aside ? (
        <aside className="hidden xl:sticky xl:top-4 xl:block xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-auto">
          {aside}
        </aside>
      ) : null}
    </div>
  );
}

/**
 * Một bài đọc: tiêu đề lớn, dòng thông tin phụ (commit, giờ cập nhật…) và thân bài. Chiều rộng chữ giới hạn cho dễ đọc.
 */
function DocArticle({ title, meta, children }: { title: string; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <article aria-label={title} data-slot="doc-article" className="flex w-full max-w-3xl min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-2 border-b pb-4">
        <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">{title}</h1>
        {meta ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">{meta}</div>
        ) : null}
      </header>
      {children}
    </article>
  );
}

/** Phần phụ gọn ở cuối bài hoặc cuối thanh bên (liên kết trong trang, file bị bỏ…): tiêu đề nhỏ, chữ nhỏ. */
function DocAppendix({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} data-slot="doc-appendix" className="flex flex-col gap-2 border-t pt-4 text-sm">
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {children}
    </section>
  );
}

interface DocNavGroup {
  id: string;
  title: string;
  items: { id: string; title: string }[];
}

/** Mục lục theo nhóm. `href` là neo `#id` để chép link và mở tab mới được. */
function DocNav({ label, groups }: { label: string; groups: DocNavGroup[] }) {
  return (
    <nav aria-label={label} data-slot="doc-nav" className="flex flex-col gap-4 text-sm">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
      {groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-1">
          <p className="font-medium text-foreground">{group.title}</p>
          <ul className="flex flex-col border-l border-border">
            {group.items.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className="-ml-px block border-l border-transparent py-1 pl-3 text-muted-foreground hover:border-foreground hover:text-foreground"
                >
                  {item.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Một nhóm mục (cấp 2), như nhóm trong thanh bên của tài liệu Paperclip. */
function DocGroup({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} data-slot="doc-group" aria-labelledby={`${id}-title`} className="flex scroll-mt-6 flex-col gap-8">
      <h2 id={`${id}-title`} className="border-b pb-2 text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Một mục có neo (cấp 3). `scroll-mt` để neo không bị mép trên che. */
function DocSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} data-slot="doc-section" aria-label={title} className="flex scroll-mt-6 flex-col gap-3">
      <h3 className="group text-base font-semibold">
        {title}
        <a
          href={`#${id}`}
          aria-label={`#${id}`}
          className="ml-2 text-muted-foreground opacity-0 group-hover:opacity-100"
        >
          #
        </a>
      </h3>
      {children}
    </section>
  );
}

/** Hình minh họa có khung, chú thích, và nhãn phụ (ví dụ "Sơ đồ, không phải ảnh chụp"). */
function DocFigure({
  src,
  alt,
  caption,
  note,
  className,
}: {
  src: string;
  alt: string;
  caption: string;
  note?: string;
  className?: string;
}) {
  return (
    <figure data-slot="doc-figure" className={cn('flex flex-col gap-2', className)}>
      <img src={src} alt={alt} loading="lazy" className="w-full rounded-lg border bg-background shadow-sm" />
      <figcaption className="text-sm text-muted-foreground">
        {caption}
        {note ? <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{note}</span> : null}
      </figcaption>
    </figure>
  );
}

export type { DocNavGroup };
export { DocAppendix, DocArticle, DocFigure, DocGroup, DocLayout, DocNav, DocSection };
