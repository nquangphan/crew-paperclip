// Kiểm lời nhắn Duyệt / Yêu cầu sửa bằng Jev trước khi gửi. Jev chỉ có thể hỏi lại một lần, không bao giờ chặn:
// tắt, shadow, lỗi, quá hạn 1500 ms hay response sai dạng đều gửi ngay như khi chưa có Jev.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JudgeAction } from '@/api';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ds';
import { useT } from '@/i18n';
import { judgeApprovalNote, recordOutcome } from './judge-client';

export interface ApprovalPrompt {
  action: JudgeAction;
  note: string;
  /** Nhãn Jev cho lời nhắn (approve / request_changes / unclear). */
  label: string;
  judgmentId: string | null;
}

interface Options {
  companyId: string;
  issueId: string;
  /** Gửi thao tác thật (đường cũ). */
  send: (action: JudgeAction, note: string) => void;
}

export function useApprovalNoteCheck({ companyId, issueId, send }: Options) {
  const [checking, setChecking] = useState(false);
  const [prompt, setPrompt] = useState<ApprovalPrompt | null>(null);
  // Mỗi lần kiểm có một số thứ tự; hủy (đóng dialog) hay kiểm mới làm kết quả cũ bị bỏ, không gửi sau lưng người dùng.
  const ticket = useRef(0);
  const busy = useRef(false);
  useEffect(
    () => () => {
      ticket.current += 1;
    },
    [],
  );

  /** `skipJudge`: lời nhắn là câu mặc định chưa sửa, không đáng một lượt gọi. */
  const check = useCallback(
    async (action: JudgeAction, note: string, skipJudge = false) => {
      if (busy.current) return;
      const text = note.trim();
      if (skipJudge || text === '') {
        send(action, note);
        return;
      }
      busy.current = true;
      const mine = ++ticket.current;
      setChecking(true);
      const verdict = await judgeApprovalNote(companyId, { issueId, action, note: text });
      busy.current = false;
      if (mine !== ticket.current) return;
      setChecking(false);
      if (verdict && verdict.mode === 'on' && verdict.mismatch && verdict.label) {
        setPrompt({ action, note, label: verdict.label, judgmentId: verdict.judgmentId });
        return;
      }
      send(action, note);
    },
    [companyId, issueId, send],
  );

  /** Đóng dialog lời nhắn: bỏ lượt kiểm đang chờ. */
  const cancel = useCallback(() => {
    ticket.current += 1;
    busy.current = false;
    setChecking(false);
    setPrompt(null);
  }, []);

  const confirmSend = useCallback(() => {
    if (!prompt) return;
    recordOutcome(companyId, prompt.judgmentId, 'sent');
    setPrompt(null);
    send(prompt.action, prompt.note);
  }, [companyId, prompt, send]);

  const edit = useCallback(() => {
    if (prompt) recordOutcome(companyId, prompt.judgmentId, 'changed');
    setPrompt(null);
  }, [companyId, prompt]);

  return { check, cancel, checking, prompt, confirmSend, edit };
}

/** Hộp hỏi lại một lần khi Jev thấy lời nhắn lệch với thao tác. Đóng hộp (Esc) tính là Sửa lại. */
export function ApprovalNoteConfirm({
  prompt,
  onSend,
  onEdit,
}: {
  prompt: ApprovalPrompt | null;
  onSend: () => void;
  onEdit: () => void;
}) {
  const { t } = useT('jev');
  return (
    <Dialog open={prompt !== null} onOpenChange={(next) => !next && onEdit()}>
      <DialogContent data-testid="jev-approval-confirm">
        <DialogHeader>
          <DialogTitle>{t('approval.title')}</DialogTitle>
          <DialogDescription>
            {prompt
              ? t('approval.body', {
                  label: t(`approval.label.${prompt.label}`, { defaultValue: prompt.label }),
                  action: t(`approval.action.${prompt.action}`),
                })
              : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onEdit}>
            {t('approval.edit')}
          </Button>
          <Button type="button" onClick={onSend}>
            {t('approval.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
