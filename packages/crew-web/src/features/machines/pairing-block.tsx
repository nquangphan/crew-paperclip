// Nhãn ghép máy trên thẻ máy (S15.4): "Đã ghép <giờ>" hoặc "Đã gỡ <giờ>". Chủ company (owner) thấy nút "Gỡ máy" khi máy
// còn ghép. Gỡ = đọc environment và đối chiếu `host` với IP Tailscale đã ghép (app gửi nhầm `environmentId` thì không
// archive nhầm máy khác), archive environment bằng route lõi (không bao giờ xóa), rồi thu hồi key máy ở plugin. Lỗi ở
// bước nào hiện nguyên văn và nút còn đó; các bước idempotent nên bấm lại là đi tiếp.

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
      if (!pairing) return;
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
      await api.machines.unpair(companyId, machine.machineId);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.crew() });
    },
  });

  if (!pairing) return null;
  const revoked = pairing.revokedAt !== null;
  return (
    <div className="flex flex-col gap-2" data-slot="machine-pairing">
      <div className="flex items-center justify-between gap-3">
        <Badge variant={revoked ? 'secondary' : 'default'}>
          {revoked
            ? t('pairing.revoked', { time: formatDateTime(pairing.revokedAt, lang) })
            : t('pairing.paired', { time: formatDateTime(pairing.pairedAt, lang) })}
        </Badge>
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
        body={t('pairing.confirmBody', { host: machine.hostname })}
        confirmLabel={t('pairing.confirmAction')}
        onConfirm={() => {
          setConfirming(false);
          unpair.mutate();
        }}
      />
    </div>
  );
}
