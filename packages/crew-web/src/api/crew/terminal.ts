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
};

export const __endpoints = ['terminal.targets', 'terminal.unlockStatus', 'terminal.unlock', 'terminal.ticket'];
