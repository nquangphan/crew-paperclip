// S0.4: Cmd/Ctrl+K. Gõ mã PREFIX-123 mở đúng issue; gõ chữ thì tìm GET /companies/:c/issues?q=; kèm lối tới các trang.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, queryKeys } from '@/api';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/ds';
import { useT } from '@/i18n';
import { useCompany } from '../hooks';
import { companyPath, ISSUE_REF_RE, NAV_ITEMS } from '../routes-util';

function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setV(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return v;
}

export function CommandPalette({
  open,
  onOpenChange,
  segments,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  segments: ReadonlySet<string>;
}) {
  const { t } = useT();
  const navigate = useNavigate();
  const { company } = useCompany();
  const [text, setText] = useState('');
  const q = text.trim();
  const debounced = useDebounced(q, 250);
  const ref = ISSUE_REF_RE.exec(q);
  const searchEnabled = open && !ref && debounced.length >= 2;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) setText('');
  }, [open]);

  const found = useQuery({
    queryKey: queryKeys.issues(company.id, { q: debounced, limit: 8 }),
    queryFn: () => api.issues.list(company.id, { q: debounced, limit: 8 }),
    enabled: searchEnabled,
  });

  const go = (to: string) => {
    onOpenChange(false);
    navigate(companyPath(company.issuePrefix, to));
  };

  const goSearch = () => go(`search?q=${encodeURIComponent(q).replace(/%20/g, '+')}`);

  const pages = NAV_ITEMS.filter((i) => i.id !== 'newIssue' && segments.has(i.segment));
  const issueRef = ref ? `${ref[1].toUpperCase()}-${ref[2]}` : null;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('palette.title')}
      description={t('palette.description', { example: `${company.issuePrefix}-12` })}
    >
      <CommandInput value={text} onValueChange={setText} placeholder={t('palette.placeholder')} />
      <CommandList>
        <CommandEmpty>{found.isFetching ? t('palette.searching') : t('palette.empty')}</CommandEmpty>
        {q && !issueRef && segments.has('search') ? (
          <CommandGroup heading={t('palette.search')}>
            <CommandItem value={`search ${q}`} keywords={[q]} onSelect={goSearch}>
              {t('palette.openSearch', { q })}
            </CommandItem>
          </CommandGroup>
        ) : null}
        {issueRef && segments.has('issues') ? (
          <CommandGroup heading={t('palette.issues')}>
            <CommandItem value={`ref ${issueRef}`} keywords={[q]} onSelect={() => go(`issues/${issueRef}`)}>
              {t('palette.openIssue', { ref: issueRef })}
            </CommandItem>
          </CommandGroup>
        ) : null}
        {searchEnabled && found.data?.length && segments.has('issues') ? (
          <CommandGroup heading={t('palette.issues')}>
            {found.data.map((issue) => (
              <CommandItem
                key={issue.id}
                value={`issue ${issue.id}`}
                keywords={[q, issue.identifier ?? '', issue.title]}
                onSelect={() => go(`issues/${issue.identifier ?? issue.id}`)}
              >
                <span className="shrink-0">{issue.identifier}</span>
                <span className="min-w-0 truncate">{issue.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {pages.length ? (
          <CommandGroup heading={t('palette.pages')}>
            {pages.map((p) => (
              <CommandItem key={p.id} value={`page ${p.id} ${t(`nav.${p.id}`)}`} onSelect={() => go(p.to)}>
                {t(`nav.${p.id}`)}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
