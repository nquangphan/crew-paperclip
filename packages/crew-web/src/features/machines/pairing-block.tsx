// Nhãn ghép máy trên thẻ máy (S15.4): "Đã ghép <giờ>" hoặc "Đã gỡ <giờ>". Chủ company (owner) thấy nút "Gỡ máy" trên
// mọi máy chưa gỡ. Máy đã ghép: đọc environment và đối chiếu `host` với IP Tailscale đã ghép (app gửi nhầm
// `environmentId` thì không archive nhầm máy khác), archive environment bằng route lõi (không bao giờ xóa), rồi thu hồi
// key máy ở plugin. Máy chưa ghép (gửi bản tin bằng secret chung của company): không có environment để đối chiếu hay
// archive, chỉ gọi unpair để plugin chặn bản tin của nó; muốn dùng lại thì app bấm "Ghép lại". Lỗi ở bước nào hiện
// nguyên văn và nút còn đó; các bước idempotent nên bấm lại là đi tiếp.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { CrewMachine } from '@/api';
import { api, queryKeys } from '@/api';
import { Alert, Badge, Button, ConfirmDialog } from '@/ds';
import { useCompanyAccess } from '@/features/access';
import { formatDateTime, useT } from '@/i18n';

interface PairingBlockProps {
  companyId: string;
  machine: CrewMachine;
}

export function PairingBlock({ companyId, machine }: PairingBlockProps) {
  const { t, lang } = useT('machines');
  const { isOwner } = useCompanyAccess();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const pairing = machine.pairing;

  const unpair = useMutation({
    mutationFn: async () => {
      if (pairing) {
        if (pairing.revokedAt !== null || pairing.environmentId === null) return;
        const environment = await api.environments.get(pairing.environmentId);
        const host = environment.config?.host;
        if (host !== pairing.tailscaleIp) {
          throw new Error(
            t('pairing.hostMismatch', {
              environment: environment.name,
              actual: typeof host === 'string' && host ? host : '?',
              expected: pairing.tailscaleIp,
            }),
          );
        }
        await api.environments.archive(pairing.environmentId);
      }
      await api.machines.unpair(companyId, machine.machineId);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.crew() });
    },
  });

  const revoked = pairing !== null && pairing.revokedAt !== null;
  if (!pairing && !isOwner) return null;
  return (
    <div className="flex flex-col gap-2" data-slot="machine-pairing">
      <div className="flex items-center justify-between gap-3">
        {pairing ? (
          <Badge variant={revoked ? 'secondary' : 'default'}>
            {pairing.revokedAt !== null
              ? t('pairing.revoked', { time: formatDateTime(pairing.revokedAt, lang) })
              : t('pairing.paired', { time: formatDateTime(pairing.pairedAt, lang) })}
          </Badge>
        ) : (
          <span />
        )}
        {!revoked && isOwner ? (
          <Button variant="outline" size="sm" disabled={unpair.isPending} onClick={() => setConfirming(true)}>
            {t('pairing.unpair')}
          </Button>
        ) : null}
      </div>
      {unpair.error ? (
        <Alert variant="destructive" title={t('pairing.failed')}>
          {unpair.error.message}
        </Alert>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        destructive
        title={t('pairing.confirmTitle', { host: machine.hostname })}
        body={t(pairing ? 'pairing.confirmBody' : 'pairing.confirmBodyUnpaired', { host: machine.hostname })}
        confirmLabel={t('pairing.confirmAction')}
        onConfirm={() => {
          setConfirming(false);
          unpair.mutate();
        }}
      />
    </div>
  );
}
