// crew: tự dựng
import { useState } from 'react';
import {
  Alert,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  MutedText,
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
import { inviteLink, isContributorInvite } from './members-model';
import { useInvites, useMemberActions } from './use-members';

/** Mời khách góp ý: tạo lời mời, hiện link để chép, danh sách lời mời còn hiệu lực kèm nút thu hồi. */
export function InvitesSection() {
  const { t, lang } = useT('members');
  const invites = useInvites();
  const { createInvite, revokeInvite } = useMemberActions();
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const create = () => {
    setCopied(false);
    createInvite.mutate(undefined, { onSuccess: (inv) => setLink(inviteLink(window.location.origin, inv.token)) });
  };
  const copy = () => {
    if (!link) return;
    void navigator.clipboard
      ?.writeText(link)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  return (
    <Section title={t('invites.title')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MutedText>{t('invites.hint')}</MutedText>
        <Button type="button" onClick={create} disabled={createInvite.isPending}>
          {createInvite.isPending ? t('invites.creating') : t('invites.create')}
        </Button>
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
                <Input id="invite-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
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
              <TableHead>{t('invites.createdAt')}</TableHead>
              <TableHead>{t('invites.expiresAt')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invites.active.map((inv) => (
              <TableRow key={inv.id} data-testid="invite-row">
                <TableCell>{isContributorInvite(inv) ? t('role.contributor') : (inv.humanRole ?? '')}</TableCell>
                <TableCell>{formatDateTime(inv.createdAt, lang)}</TableCell>
                <TableCell>{formatDateTime(inv.expiresAt, lang)}</TableCell>
                <TableCell>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setRevoking(inv.id)}>
                    {t('invites.revoke')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
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
          if (revoking) revokeInvite.mutate(revoking);
          setRevoking(null);
        }}
      />
    </Section>
  );
}
