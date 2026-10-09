// Duyệt đăng nhập CLI (app 2P Crew lấy board key). Nguồn: server/src/routes/access.ts:2790-2885.
import { call } from '../endpoints';

export interface CliAuthChallenge {
  id: string;
  status: 'pending' | 'approved' | 'cancelled' | 'expired';
  command: string;
  clientName: string | null;
  requestedAccess: 'board' | 'instance_admin_required';
  requestedCompanyId: string | null;
  requestedCompanyName: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  expiresAt: string;
  approvedByUser: { id: string; name: string; email: string } | null;
  requiresSignIn: boolean;
  canApprove: boolean;
  currentUserId: string | null;
}

export const cliAuthApi = {
  get: (id: string, token: string): Promise<CliAuthChallenge> => call('cliAuth.get', { id }, { query: { token } }),
  approve: (id: string, token: string): Promise<{ approved: boolean; status: string }> =>
    call('cliAuth.approve', { id }, { body: { token } }),
  cancel: (id: string, token: string): Promise<{ cancelled: boolean; status: string }> =>
    call('cliAuth.cancel', { id }, { body: { token } }),
};

export const __endpoints = ['cliAuth.approve', 'cliAuth.cancel', 'cliAuth.get'];
