// crew: tự dựng
// Popup đọc một trang docs trên bản đồ Roadmap: cùng khung với popup chi tiết yêu cầu, thanh trên có đường dẫn trang,
// thao tác (ví dụ "Mở trong trang Docs") và nút Đóng; thân là bài đọc của trang Docs.
import { X } from 'lucide-react';
import type * as React from 'react';
import { useT } from '@/i18n';
import { Button } from '../../components/button';
import { DialogTitle } from '../../components/dialog';
import { IssuePopupFrame } from '../issue-detail';

interface RoadmapDocPopupProps {
  /** Tên hộp cho trình đọc màn hình (tiêu đề trang hoặc đường dẫn). */
  title: string;
  /** Dòng nhỏ trên thanh trên (đường dẫn trang). */
  path: string;
  actions?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}

function RoadmapDocPopup({ title, path, actions, onClose, children }: RoadmapDocPopupProps) {
  const { t } = useT();
  return (
    <IssuePopupFrame
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      testId="roadmap-doc-popup"
    >
      <DialogTitle className="sr-only">{title}</DialogTitle>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{path}</span>
        {actions}
        <Button variant="ghost" size="icon-sm" aria-label={t('roadmap.doc.close')} onClick={onClose}>
          <X aria-hidden />
        </Button>
      </div>
      <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8">{children}</div>
    </IssuePopupFrame>
  );
}

export type { RoadmapDocPopupProps };
export { RoadmapDocPopup };
