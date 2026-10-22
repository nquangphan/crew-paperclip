// Công tắc chung của Jev (S24.6): một nút nổi bật ở đầu trang. Tắt là tắt mọi chỗ dùng Jev: cổng chặn lệnh trên Mac,
// so sánh C3 phía server và cả bốn tính năng. Cột `enabled` của cấu hình chính là công tắc này.
import { useState } from 'react';
import type { JevSettings } from '@/api';
import { Alert, Button, ConfirmDialog } from '@/ds';
import { useT } from '@/i18n';
import { settingsInput, useSaveJevSettings } from './use-jev';

export function MasterSwitch({ companyId, settings }: { companyId: string; settings: JevSettings }) {
  const { t } = useT('jev');
  const [confirm, setConfirm] = useState(false);
  const save = useSaveJevSettings(companyId);
  const on = settings.enabled;
  const apply = (enabled: boolean) => save.mutate(settingsInput(settings, { enabled }));

  return (
    <div data-testid="jev-master" data-enabled={on} className="flex flex-col gap-3">
      <Alert variant={on ? 'info' : 'warning'} title={on ? t('master.onTitle') : t('master.offTitle')}>
        {on ? t('master.onBody') : t('master.offBody')}
      </Alert>
      <div className="flex flex-wrap items-center gap-3">
        {on ? (
          <Button variant="destructive" disabled={save.isPending} onClick={() => setConfirm(true)}>
            {t('master.turnOff')}
          </Button>
        ) : (
          <Button disabled={save.isPending} onClick={() => apply(true)}>
            {t('master.turnOn')}
          </Button>
        )}
      </div>
      {save.error ? (
        <Alert variant="destructive" title={t('master.failed')}>
          {save.error.message}
        </Alert>
      ) : null}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('master.confirm.title')}
        body={t('master.confirm.body')}
        confirmLabel={t('master.turnOff')}
        destructive
        onConfirm={() => {
          setConfirm(false);
          apply(false);
        }}
      />
    </div>
  );
}
