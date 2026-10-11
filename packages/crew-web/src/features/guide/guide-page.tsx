// Trang Hướng dẫn: nội dung theo ngôn ngữ đang chọn và theo vai trò đang đăng nhập, mục lục theo nhóm bên trái, mỗi mục
// có neo `#id` để gửi link thẳng. Owner xem thử bản của vai trò khác bằng ô "Xem hướng dẫn của" (`?role=`).
import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useCompany } from '@/app/hooks';
import {
  Badge,
  DocGroup,
  DocLayout,
  DocNav,
  DocSection,
  Label,
  MarkdownView,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '@/ds';
import { useCompanyAccess } from '@/features/access';
import { companyHref } from '@/features/projects/paths';
import { useT } from '@/i18n';
import enMarkdown from './content/guide.en.md?raw';
import viMarkdown from './content/huong-dan.vi.md?raw';
import { filterGuide, type GuideBlock, parseGuide, prefixInternalLinks } from './guide-parse';
import { GUIDE_ROLES, type GuideRole, guideRoleFor, isGuideRole, previewRole } from './guide-roles';
import { GuideShot } from './guide-shot';
import { MissingFeaturesSection } from './missing-features-section';

function Blocks({ blocks, role }: { blocks: GuideBlock[]; role: GuideRole }) {
  return (
    <>
      {blocks.map((block, i) => {
        const key = `${block.type}-${i}`;
        if (block.type === 'shot' || block.type === 'diagram') return <GuideShot key={key} id={block.id} role={role} />;
        if (block.type === 'missing') return <MissingFeaturesSection key={key} />;
        return <MarkdownView key={key} markdown={block.text} />;
      })}
    </>
  );
}

function RoleSwitch({ role, onChange }: { role: GuideRole; onChange: (role: GuideRole) => void }) {
  const { t } = useT('guide');
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="guide-role">{t('roleSwitch')}</Label>
      <Select value={role} onValueChange={(v) => isGuideRole(v) && onChange(v)}>
        <SelectTrigger id="guide-role" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {GUIDE_ROLES.map((r) => (
            <SelectItem key={r} value={r}>
              {t(`roles.${r}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function GuidePage() {
  const { t, lang } = useT('guide');
  const { company } = useCompany();
  const access = useCompanyAccess();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const [params, setParams] = useSearchParams();
  const body = useRef<HTMLDivElement>(null);
  const own = guideRoleFor(access);
  const role = own ? previewRole(own, params.get('role')) : null;
  const full = useMemo(
    () =>
      parseGuide(
        prefixInternalLinks(lang === 'en' ? enMarkdown : viMarkdown, (to) => companyHref(company.issuePrefix, to)),
      ),
    [lang, company.issuePrefix],
  );
  const doc = useMemo(() => (role ? filterGuide(full, role) : null), [full, role]);

  // Link nội bộ (đã gắn tiền tố company) chuyển trang trong app, không tải lại. Nội dung chỉ có sau khi biết vai trò.
  useEffect(() => {
    const el = body.current;
    if (!el || !doc) return;
    const onClick = (event: MouseEvent) => {
      const href = (event.target as Element | null)?.closest('a')?.getAttribute('href');
      if (!href?.startsWith('/') || href.startsWith('//') || event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      navigate(href);
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [navigate, doc]);

  // Mở bằng link có `#id` (hoặc bấm mục lục): nội dung dựng xong mới cuộn tới được.
  useEffect(() => {
    if (!doc || !hash) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView?.();
  }, [doc, hash]);

  if (!doc || !role || !own) {
    return (
      <>
        <PageHeader title={t('title')} description={t('description')} />
        <Spinner />
      </>
    );
  }

  const pickRole = (next: GuideRole) =>
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      if (next === 'owner') out.delete('role');
      else out.set('role', next);
      return out;
    });
  const actions =
    own === 'owner' ? (
      <RoleSwitch role={role} onChange={pickRole} />
    ) : (
      <Badge variant="secondary">{t('audience', { role: t(`roles.${role}`) })}</Badge>
    );
  const nav = doc.groups.map((g) => ({
    id: g.id,
    title: g.title,
    items: g.sections.map((s) => ({ id: s.id, title: s.title })),
  }));

  return (
    <>
      <PageHeader title={doc.title} description={t('description')} actions={actions} />
      <div ref={body} data-guide-role={role}>
        <DocLayout nav={<DocNav label={t('toc')} groups={nav} />}>
          <div className="flex flex-col gap-3">
            <Blocks blocks={doc.intro} role={role} />
          </div>
          {doc.groups.map((group) => (
            <DocGroup key={group.id} id={group.id} title={group.title}>
              {group.sections.map((section) => (
                <DocSection key={section.id} id={section.id} title={section.title}>
                  <Blocks blocks={section.blocks} role={role} />
                </DocSection>
              ))}
            </DocGroup>
          ))}
        </DocLayout>
      </div>
    </>
  );
}
