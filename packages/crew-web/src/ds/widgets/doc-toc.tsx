// crew: tự dựng
// "Trên trang này": mục lục từ heading h2/h3 của bài đang đọc. Cột phải dính khi cuộn (màn rộng, tô mục đang đọc) hoặc
// khối thu gọn đầu bài (màn hẹp). Heading lấy từ DOM của bài (MarkdownView `variant="document"` gắn id).
import { type RefObject, useEffect, useState } from 'react';
import { cn } from '../cn';

interface DocHeading {
  id: string;
  text: string;
  level: 2 | 3;
}

/** Heading nằm trên mốc này (tính từ mép trên khung nhìn) được coi là mục đang đọc. */
const ACTIVE_OFFSET = 120;

const sameHeadings = (a: DocHeading[], b: DocHeading[]) =>
  a.length === b.length && a.every((h, i) => h.id === b[i]?.id && h.text === b[i]?.text && h.level === b[i]?.level);

/**
 * Đọc heading h2/h3 có id trong `root`, theo dõi thay đổi DOM (markdown tải lười, đổi trang). `key` đổi (ví dụ đường dẫn
 * trang) thì gắn lại bộ theo dõi vì phần tử gốc có thể đã thay.
 */
function useDocHeadings(root: RefObject<HTMLElement | null>, key: unknown): DocHeading[] {
  const [headings, setHeadings] = useState<DocHeading[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` báo phần tử gốc có thể đã đổi
  useEffect(() => {
    const el = root.current;
    if (!el) {
      setHeadings([]);
      return;
    }
    const read = () => {
      const found = [...el.querySelectorAll('h2[id], h3[id]')].map(
        (h): DocHeading => ({ id: h.id, text: h.textContent?.trim() ?? '', level: h.tagName === 'H3' ? 3 : 2 }),
      );
      setHeadings((prev) => (sameHeadings(prev, found) ? prev : found));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [root, key]);
  return headings;
}

/** Mục đang đọc: heading cuối cùng đã cuộn qua mốc. Nghe cuộn ở mọi khung (vùng nội dung của app tự cuộn). */
function useActiveHeading(headings: DocHeading[]): [string | null, (id: string) => void] {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!headings.length) {
      setActive(null);
      return;
    }
    const update = () => {
      let current = headings[0]?.id ?? null;
      for (const heading of headings) {
        const el = document.getElementById(heading.id);
        if (el && el.getBoundingClientRect().top <= ACTIVE_OFFSET) current = heading.id;
      }
      setActive(current);
    };
    update();
    document.addEventListener('scroll', update, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', update, { capture: true });
  }, [headings]);
  return [active, setActive];
}

function TocLinks({
  headings,
  active,
  onPick,
}: {
  headings: DocHeading[];
  active: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <ul className="flex flex-col border-l border-border">
      {headings.map((h) => (
        <li key={h.id}>
          <a
            href={`#${encodeURIComponent(h.id)}`}
            onClick={() => onPick(h.id)}
            aria-current={h.id === active ? 'location' : undefined}
            className={cn(
              '-ml-px block border-l border-transparent py-1 text-muted-foreground hover:border-foreground hover:text-foreground',
              h.level === 3 ? 'pl-6' : 'pl-3',
              h.id === active && 'border-foreground font-medium text-foreground',
            )}
          >
            {h.text}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Mục lục của bài. `rail`: cột phải (DocLayout `aside`). `collapsed`: khối `<details>` đầu bài, chỉ hiện dưới mốc `xl`
 * (từ `xl` đã có cột phải). Bài không có heading thì không hiện gì.
 */
function DocToc({
  label,
  headings,
  variant = 'rail',
}: {
  label: string;
  headings: DocHeading[];
  variant?: 'rail' | 'collapsed';
}) {
  const [active, setActive] = useActiveHeading(headings);
  if (!headings.length) return null;
  if (variant === 'collapsed') {
    return (
      <details data-slot="doc-toc" className="rounded-lg border bg-card text-sm xl:hidden">
        <summary className="cursor-pointer px-3 py-2 font-medium">{label}</summary>
        <nav aria-label={label} className="px-3 pb-3">
          <TocLinks headings={headings} active={active} onPick={setActive} />
        </nav>
      </details>
    );
  }
  return (
    <nav aria-label={label} data-slot="doc-toc" className="flex flex-col gap-3 text-sm">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
      <TocLinks headings={headings} active={active} onPick={setActive} />
    </nav>
  );
}

export type { DocHeading };
export { DocToc, useDocHeadings };
