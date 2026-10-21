// crew: tự dựng
import { useState } from 'react';
import type { ContributorDepartment } from '@/api';
import {
  Alert,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  MutedText,
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
  Section,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds';
import { Check, Copy } from '@/ds/icons';
import { formatDateTime, useT } from '@/i18n';
import { CONTRIBUTOR_DEPARTMENTS, inviteDepartment, inviteLink, inviteProjectIds } from './members-model';
import { ProjectChecklist, ProjectNames } from './project-access-cell';
import { useInvites, useMemberActions, useProjectAccess } from './use-members';

/**
 * Mời khách góp ý vào Phòng Marketing hoặc Phòng QC (mỗi phòng một nút): chọn sẵn project người được mời sẽ xem rồi tạo
 * lời mời, hiện link để chép, danh sách lời mời còn hiệu lực kèm phòng, project đã chọn và nút thu hồi.
 */
export function InvitesSection() {
  const { t, lang } = useT('members');
  const invites = useInvites();
  const { choices } = useProjectAccess();
  const { createInvite, revokeInvite } = useMemberActions();
  // Phòng đang chọn project để mời; null khi không mở hộp chọn nào.
  const [picking, setPicking] = useState<ContributorDepartment | null>(null);
  const [draft, setDraft] = useState<ReadonlySet<string>>(new Set());
  // Link chỉ hiện một lần sau khi tạo; giữ id lời mời để xóa link khi chính lời mời đó bị thu hồi.
  const [link, setLink] = useState<{ inviteId: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const create = (department: ContributorDepartment) => {
    setCopied(false);
    createInvite.mutate(
      { department, projectIds: [...draft] },
      {
        onSuccess: (inv) => {
          setLink({ inviteId: inv.id, url: inviteLink(window.location.origin, inv.token) });
          setPicking(null);
        },
      },
    );
  };
  const copy = () => {
    if (!link) return;
    void navigator.clipboard
      ?.writeText(link.url)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  return (
    <Section title={t('invites.title')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MutedText>{t('invites.hint')}</MutedText>
        <div className="flex flex-wrap gap-2">
          {CONTRIBUTOR_DEPARTMENTS.map((department) => {
            const name = t(`role.${department}`);
            return (
              <Popover
                key={department}
                open={picking === department}
                onOpenChange={(next) => {
                  if (next) setDraft(new Set());
                  setPicking(next ? department : null);
                }}
              >
                <PopoverTrigger asChild>
                  <Button type="button" data-department={department}>
                    {t('invites.create', { department: name })}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end">
                  <div
                    className="flex flex-col gap-3"
                    data-testid="invite-projects-editor"
                    data-department={department}
                  >
                    <PopoverTitle>{t('invites.projectsTitle', { department: name })}</PopoverTitle>
                    <MutedText>{t('invites.projectsHint')}</MutedText>
                    <ProjectChecklist
                      idPrefix={`invite-project-${department}`}
                      projects={choices}
                      selected={draft}
                      onChange={setDraft}
                    />
                    <div className="flex justify-end gap-2">
                      <Button type="button" size="sm" variant="ghost" onClick={() => setPicking(null)}>
                        {t('projects.cancel')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={createInvite.isPending}
                        onClick={() => create(department)}
                      >
                        {createInvite.isPending ? t('invites.creating') : t('invites.createLink')}
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            );
          })}
        </div>
      </div>

      {createInvite.error ? (
        <ErrorState title={t('invites.createFailed')} message={createInvite.error.message} />
      ) : null}
      {revokeInvite.error ? (
        <ErrorState title={t('invites.revokeFailed')} message={revokeInvite.error.message} />
      ) : null}

      {link ? (
        <Alert variant="info" title={t('invites.created')}>
          <div className="grid gap-2">
            <Field label={t('invites.linkLabel')} htmlFor="invite-link" hint={t('invites.linkHint')}>
              <div className="flex items-center gap-2">
                <Input id="invite-link" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
                <Button type="button" variant="outline" onClick={copy}>
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {copied ? t('invites.copied') : t('invites.copy')}
                </Button>
              </div>
            </Field>
          </div>
        </Alert>
      ) : null}

      {invites.error ? (
        <ErrorState
          title={t('invites.loadFailed')}
          message={invites.error.message}
          onRetry={() => void invites.refetch()}
        />
      ) : invites.isLoading ? (
        <Skeleton />
      ) : invites.active.length === 0 ? (
        <EmptyState title={t('invites.empty')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('invites.kind')}</TableHead>
              <TableHead>{t('invites.projects')}</TableHead>
              <TableHead>{t('invites.createdAt')}</TableHead>
              <TableHead>{t('invites.expiresAt')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invites.active.map((inv) => {
              const department = inviteDepartment(inv);
              return (
                <TableRow key={inv.id} data-testid="invite-row">
                  <TableCell>{department ? t(`role.${department}`) : (inv.humanRole ?? '')}</TableCell>
                  <TableCell data-testid="invite-projects">
                    <ProjectNames projectIds={inviteProjectIds(inv)} projects={choices} />
                  </TableCell>
                  <TableCell>{formatDateTime(inv.createdAt, lang)}</TableCell>
                  <TableCell>{formatDateTime(inv.expiresAt, lang)}</TableCell>
                  <TableCell>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setRevoking(inv.id)}>
                      {t('invites.revoke')}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={t('invites.revokeTitle')}
        body={t('invites.revokeBody')}
        confirmLabel={t('invites.revoke')}
        destructive
        onConfirm={() => {
          if (revoking)
            revokeInvite.mutate(revoking, {
              onSuccess: () => setLink((current) => (current?.inviteId === revoking ? null : current)),
            });
          setRevoking(null);
        }}
      />
    </Section>
  );
}
