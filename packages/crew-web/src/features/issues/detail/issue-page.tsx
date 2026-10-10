// crew: tự dựng
import { useParams } from 'react-router-dom';
import { IssueDetail } from './issue-detail';

/** Trang chi tiết yêu cầu đầy đủ `/:companyPrefix/issues/:ref` (link trực tiếp, tab mới, "Mở toàn trang"). */
export function IssuePage() {
  const { ref } = useParams<{ ref: string }>();
  return <IssueDetail issueRef={ref} variant="page" />;
}
