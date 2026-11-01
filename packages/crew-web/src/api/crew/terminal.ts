// Terminal web của owner: router Crew của server. Chỉ owner gọi được; vé mở WebSocket cần đã mở khoá bằng mật khẩu.
import { call } from '../endpoints';

/** Máy đã ghép và project `ready` trên máy đó, mở được terminal. */
export interface TerminalTarget {
  machineId: string;
  hostname: string;
  projectId: string;
  projectName: string;
  projectKey: string;
  branch: string | null;
}

export interface TerminalUnlockStatus {
  unlocked: boolean;
  expiresAt: string | null;
}

/** Phiên tmux owner đang sống trên một máy (mở từ bất kỳ trình duyệt hay máy nào). */
export interface TerminalMachineSession {
  machineId: string;
  hostname: string;
  projectKey: string;
  /** null khi khóa không khớp dự án `ready` nào trên máy đó (dự án cũ còn phiên). */
  projectId: string | null;
  projectName: string | null;
  /** Số cửa sổ terminal đang gắn vào phiên. */
  attached: number;
  createdAt: string;
  activityAt: string;
}

export interface TerminalSessionsResult {
  items: TerminalMachineSession[];
  /** Máy đã hỏi; `ok: false` khi không hỏi được (máy tắt, lỗi SSH). */
  machines: { machineId: string; hostname: string; ok: boolean }[];
}

export interface TerminalTicket {
  ticket: string;
  expiresAt: string;
}

export const terminalApi = {
  targets: async (companyId: string): Promise<TerminalTarget[]> => {
    const res: { items: TerminalTarget[] } = await call('terminal.targets', { companyId });
    return res.items;
  },
  unlockStatus: (companyId: string): Promise<TerminalUnlockStatus> => call('terminal.unlockStatus', { companyId }),
  /** 403 `crew_terminal_bad_password` khi sai mật khẩu, 429 `crew_terminal_unlock_throttled` khi sai quá nhiều lần. */
  unlock: (companyId: string, password: string): Promise<{ expiresAt: string }> =>
    call('terminal.unlock', { companyId }, { body: { password } }),
  /** Vé WebSocket dùng một lần; 423 `crew_terminal_locked` khi chưa mở khoá, 404 khi máy/project không còn sẵn sàng. */
  ticket: (companyId: string, target: { machineId: string; projectId: string }): Promise<TerminalTicket> =>
    call('terminal.ticket', { companyId }, { body: target }),
  /** Hỏi từng máy qua SSH nên có thể mất vài giây. */
  sessions: (companyId: string): Promise<TerminalSessionsResult> => call('terminal.sessions', { companyId }),
  /** Tắt hẳn phiên tmux trên máy; 423 `crew_terminal_locked` khi chưa mở khoá. `killed` false khi phiên đã không còn. */
  killSession: (companyId: string, target: { machineId: string; projectKey: string }): Promise<{ killed: boolean }> =>
    call('terminal.killSession', { companyId }, { body: target }),
};

export const __endpoints = [
  'terminal.targets',
  'terminal.unlockStatus',
  'terminal.unlock',
  'terminal.ticket',
  'terminal.sessions',
  'terminal.killSession',
];
