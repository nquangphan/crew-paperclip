// Key API agent tạm cho ca âm (agent gọi route bị cấm). Chỉ tạo cho agent của company Crew E2E, xóa ngay sau ca.
import type { Api } from './api';
import { companyId } from './env';

export interface AgentToken {
  keyId: string;
  token: string;
  revoke(): Promise<void>;
}

export async function agentToken(api: Api, agentId: string): Promise<AgentToken> {
  const agent = await api.get<{ id: string; companyId: string }>(`/api/agents/${agentId}`);
  if (agent.companyId !== companyId()) throw new Error('agentToken chỉ tạo key cho agent của company e2e');
  const key = await api.post<{ id: string; token: string }>(`/api/agents/${agentId}/keys`, {
    name: `crew-e2e-negative-${Date.now().toString(36)}`,
  });
  let revoked = false;
  return {
    keyId: key.id,
    token: key.token,
    async revoke() {
      if (revoked) return;
      await api.delete(`/api/agents/${agentId}/keys/${key.id}`);
      revoked = true;
    },
  };
}

/** Tạo key, chạy `fn`, luôn xóa key (kể cả khi ca lỗi). */
export async function withAgentToken<T>(api: Api, agentId: string, fn: (token: string) => Promise<T>): Promise<T> {
  const t = await agentToken(api, agentId);
  try {
    return await fn(t.token);
  } finally {
    await t.revoke();
  }
}
