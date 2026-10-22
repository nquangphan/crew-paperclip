// Tên máy trong bảng Jev: hostname (nếu server biết) là dòng chính, mã máy rút gọn là dòng phụ; hover để xem mã đầy đủ.
import { MutedText } from '@/ds';

const SHORT_ID = 8;

export function MachineName({ machineId, hostname }: { machineId: string; hostname: string | null }) {
  const short = machineId.slice(0, SHORT_ID);
  return (
    <span title={machineId} data-slot="jev-machine-name" className="flex flex-col">
      <span>{hostname ?? short}</span>
      {hostname ? <MutedText>{short}</MutedText> : null}
    </span>
  );
}
