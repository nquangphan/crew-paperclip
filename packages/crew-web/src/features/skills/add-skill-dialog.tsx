// Thêm skill từ repo GitHub (S14.2): quét repo (discover), xem trước, chọn skill, tạo nguồn (create).
// Chặn tên trùng skill Superpowers (Q6). Tạo xong xếp một việc skill-sync cho mỗi máy có app nhận việc.
import type { SkillSourceDiscovery, SkillSourceFilePreview } from '@paperclipai/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  MarkdownView,
  MutedText,
  Spinner,
} from '@/ds';
import { useCrewMachines } from '@/features/machines/use-machines';
import { useT } from '@/i18n';
import { hasSuperpowersData, superpowersNameClash } from './name-guard';
import { hasJobsAgent, queueSkillSync, skillVersion } from './use-skill-sync';

type Candidate = SkillSourceDiscovery['candidates'][number];

interface AddResult {
  added: number;
  queuedMachines: number;
  waitingApp: boolean;
  failures: string[];
}

/** Thư mục chứa SKILL.md (tên thư mục cũng là tên skill Superpowers). */
const folderName = (path: string): string => path.split('/').slice(-2, -1)[0] ?? '';

interface AddSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddSkillDialog({ open, onOpenChange }: AddSkillDialogProps) {
  const { t } = useT('skills');
  const { company } = useCompany();
  const queryClient = useQueryClient();
  const machines = useCrewMachines(company.id);
  const [url, setUrl] = useState('');
  const [ref, setRef] = useState('');
  const [discovery, setDiscovery] = useState<SkillSourceDiscovery | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ name: string; file: SkillSourceFilePreview } | null>(null);
  const [result, setResult] = useState<AddResult | null>(null);

  const reports = (machines.data ?? []).map((m) => m.latest);
  const clashOf = (c: Candidate): string | null =>
    superpowersNameClash(c.name, reports) ?? superpowersNameClash(folderName(c.path), reports);
  const blocked = (c: Candidate): boolean => Boolean(c.error) || clashOf(c) !== null;

  const scan = useMutation({
    mutationFn: () =>
      api.skills.discover(company.id, {
        repositoryUrl: url.trim(),
        ...(ref.trim() ? { trackingRef: ref.trim() } : {}),
      }),
    onSuccess: (found) => {
      setDiscovery(found);
      setSelected([]);
      setPreview(null);
      setResult(null);
    },
  });
  const show = useMutation({
    mutationFn: (c: Candidate) => {
      if (!discovery) throw new Error('chưa quét repo');
      return api.skills.preview(company.id, {
        repositoryUrl: discovery.repositoryUrl,
        trackingRef: discovery.trackingRef,
        commitSha: discovery.commitSha,
        skillPath: c.path,
        filePath: c.path,
      });
    },
    onSuccess: (file, c) => setPreview({ name: c.name, file }),
  });
  const create = useMutation({
    mutationFn: async (): Promise<AddResult> => {
      if (!discovery) throw new Error('chưa quét repo');
      // Chặn lại lần nữa khi gửi: không bao giờ gửi đường dẫn bị chặn.
      const allowed = discovery.candidates.filter((c) => selected.includes(c.path) && !blocked(c)).map((c) => c.path);
      const source = await api.skills.createSource(company.id, {
        repositoryUrl: discovery.repositoryUrl,
        trackingRef: discovery.trackingRef,
        ...(discovery.connectionId ? { connectionId: discovery.connectionId } : {}),
        commitSha: discovery.commitSha,
        selectedPaths: allowed,
      });
      const skillIds = source.entries
        .filter((e) => e.selection === 'selected' && e.skillId && allowed.includes(e.path))
        .map((e) => e.skillId as string);
      const fresh = await queryClient.fetchQuery({
        queryKey: queryKeys.crew('crew.machines', { companyId: company.id }),
        queryFn: () => api.crew.machines(company.id),
        staleTime: 0,
      });
      const targets = fresh.filter(hasJobsAgent);
      const failures: string[] = [];
      if (targets.length > 0) {
        for (const skillId of skillIds) {
          try {
            const skill = await api.skills.get(company.id, skillId);
            const sync = { id: skillId, slug: skill.slug, version: skillVersion(skill) };
            const settled = await Promise.allSettled(targets.map((m) => queueSkillSync(company.id, m.machineId, sync)));
            for (const r of settled) {
              if (r.status === 'rejected')
                failures.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
            }
          } catch (error) {
            failures.push(error instanceof Error ? error.message : String(error));
          }
        }
      }
      return { added: skillIds.length, queuedMachines: targets.length, waitingApp: targets.length === 0, failures };
    },
    onSuccess: (done) => {
      setResult(done);
      void queryClient.invalidateQueries({ queryKey: queryKeys.skills(company.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.crew() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.machineJobs(company.id) });
    },
  });

  const toggle = (path: string, on: boolean) =>
    setSelected((cur) => (on ? [...cur.filter((p) => p !== path), path] : cur.filter((p) => p !== path)));
  const canScan = url.trim() !== '' && !scan.isPending;
  const canCreate = selected.length > 0 && !create.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('add.title')}</DialogTitle>
          <DialogDescription>{t('add.description')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (canScan) scan.mutate();
          }}
        >
          <Field label={t('add.url')} htmlFor="skill-repo-url" hint={t('add.urlHint')}>
            <Input id="skill-repo-url" value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <Field label={t('add.ref')} htmlFor="skill-repo-ref">
            <Input id="skill-repo-ref" value={ref} onChange={(e) => setRef(e.target.value)} />
          </Field>
          <div>
            <Button type="submit" variant="outline" disabled={!canScan}>
              {t('add.scan')}
            </Button>
          </div>
        </form>
        {scan.isPending ? <Spinner label={t('add.scanning')} /> : null}
        {scan.error ? (
          <Alert variant="destructive" title={t('add.scanFailed')}>
            {scan.error.message}
          </Alert>
        ) : null}

        {discovery ? (
          <div className="grid gap-2">
            {hasSuperpowersData(reports) ? null : <Alert variant="warning">{t('add.unknownSuperpowers')}</Alert>}
            {discovery.candidates.length === 0 ? <MutedText>{t('add.noCandidates')}</MutedText> : null}
            <ul className="flex flex-col gap-2">
              {discovery.candidates.map((c) => {
                const clash = clashOf(c);
                return (
                  <li key={c.path} className="flex items-start gap-2">
                    <Checkbox
                      aria-label={c.name}
                      checked={selected.includes(c.path)}
                      disabled={blocked(c)}
                      onCheckedChange={(on) => toggle(c.path, on === true)}
                    />
                    <div className="flex min-w-0 flex-col">
                      <span>{c.name}</span>
                      <MutedText>{c.description ?? c.path}</MutedText>
                      {clash ? <MutedText>{t('add.clash', { name: clash })}</MutedText> : null}
                      {c.error ? <MutedText>{c.error}</MutedText> : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('add.previewOf', { name: c.name })}
                      disabled={show.isPending}
                      onClick={() => show.mutate(c)}
                    >
                      {t('add.preview')}
                    </Button>
                  </li>
                );
              })}
            </ul>
            {show.error ? (
              <Alert variant="destructive" title={t('add.previewFailed')}>
                {show.error.message}
              </Alert>
            ) : null}
            {preview ? (
              <section aria-label={t('add.previewOf', { name: preview.name })} className="flex flex-col gap-1">
                {preview.file.content === null ? (
                  <MutedText>{t('add.previewEmpty')}</MutedText>
                ) : (
                  <MarkdownView markdown={preview.file.content} />
                )}
                {preview.file.truncated ? <MutedText>{t('add.truncated')}</MutedText> : null}
              </section>
            ) : null}
          </div>
        ) : null}

        {create.error ? (
          <Alert variant="destructive" title={t('add.createFailed')}>
            {create.error.message}
          </Alert>
        ) : null}
        {result ? (
          <div className="grid gap-2">
            <Alert variant="info" title={t('add.added', { count: result.added })}>
              {result.queuedMachines > 0 ? t('add.queued', { count: result.queuedMachines }) : null}
            </Alert>
            {result.waitingApp ? (
              <Alert variant="warning" title={t('add.waitingApp')}>
                {t('add.waitingAppHint')}
              </Alert>
            ) : null}
            {result.failures.length ? (
              <Alert variant="destructive" title={t('add.queueFailed')}>
                {result.failures.join('; ')}
              </Alert>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {result ? t('add.close') : t('common:action.cancel')}
          </Button>
          {result ? null : (
            <Button type="button" disabled={!canCreate} onClick={() => create.mutate()}>
              {t('add.create')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
