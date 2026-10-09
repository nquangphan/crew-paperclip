import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { type InstructionsApi, putInstructions } from '@/lib/instructions';

const AGENT = '11111111-1111-4111-8111-111111111111';
const COMPANY = '99999999-9999-4999-8999-999999999999';
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Call = { op: 'get' | 'put'; id: string; path?: string; body?: unknown; companyId?: string };

function fakeApi(opts: { current?: string | null; contentHash?: boolean; putError?: Error; getError?: Error }) {
  const calls: Call[] = [];
  const api: InstructionsApi = {
    agents: {
      instructionsFile: async (id, path, companyId) => {
        calls.push({ op: 'get', id, path, companyId });
        if (opts.getError) throw opts.getError;
        if (opts.current === null) throw new HttpError(404, 'Agent file not found');
        const content = opts.current ?? '';
        return opts.contentHash === false ? { content } : { content, contentHash: sha(content) };
      },
      saveInstructionsFile: async (id, body, companyId) => {
        calls.push({ op: 'put', id, body, companyId });
        if (opts.putError) throw opts.putError;
        return { content: body.content, contentHash: sha(body.content) };
      },
    },
  };
  return { api, calls };
}

describe('putInstructions', () => {
  it('GET lấy contentHash rồi PUT AGENTS.md kèm baseHash, trả hash mới', async () => {
    const { api, calls } = fakeApi({ current: 'cũ\n' });
    const res = await putInstructions(api, AGENT, 'mới\n', { companyId: COMPANY });
    expect(res).toEqual({ ok: true, hash: sha('mới\n'), changed: true });
    expect(calls).toEqual([
      { op: 'get', id: AGENT, path: 'AGENTS.md', companyId: COMPANY },
      {
        op: 'put',
        id: AGENT,
        body: { path: 'AGENTS.md', content: 'mới\n', baseHash: sha('cũ\n') },
        companyId: COMPANY,
      },
    ]);
  });

  it('nội dung giống hệt thì không PUT', async () => {
    const { api, calls } = fakeApi({ current: 'giữ\n' });
    expect(await putInstructions(api, AGENT, 'giữ\n')).toEqual({ ok: true, hash: sha('giữ\n'), changed: false });
    expect(calls.map((c) => c.op)).toEqual(['get']);
  });

  it('server trả 409 (baseHash cũ) thì báo xung đột, không thử lại', async () => {
    const { api, calls } = fakeApi({ current: 'cũ\n', putError: new HttpError(409, 'conflict') });
    expect(await putInstructions(api, AGENT, 'mới\n')).toEqual({ ok: false, conflict: true });
    expect(calls.map((c) => c.op)).toEqual(['get', 'put']);
  });

  it('hai tab cùng render lại: tab sau dùng hash đã cũ thì nhận xung đột', async () => {
    let stored = 'v1\n';
    const api: InstructionsApi = {
      agents: {
        instructionsFile: async () => ({ content: stored, contentHash: sha(stored) }),
        saveInstructionsFile: async (_id, body) => {
          if (body.baseHash !== sha(stored)) throw new HttpError(409, 'conflict');
          stored = body.content;
          return { content: stored, contentHash: sha(stored) };
        },
      },
    };
    const slowGet = api.agents.instructionsFile;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const tabB: InstructionsApi = {
      agents: {
        instructionsFile: async (...args) => {
          const res = await slowGet(...args);
          await gate;
          return res;
        },
        saveInstructionsFile: api.agents.saveInstructionsFile,
      },
    };
    const b = putInstructions(tabB, AGENT, 'tab B\n');
    await new Promise((r) => setTimeout(r, 0));
    expect(await putInstructions(api, AGENT, 'tab A\n')).toEqual({ ok: true, hash: sha('tab A\n'), changed: true });
    release();
    expect(await b).toEqual({ ok: false, conflict: true });
    expect(stored).toBe('tab A\n');
  });

  it('agent chưa có file (GET 404) thì PUT với baseHash null', async () => {
    const { api, calls } = fakeApi({ current: null });
    await putInstructions(api, AGENT, 'x\n');
    expect(calls[1]?.body).toEqual({ path: 'AGENTS.md', content: 'x\n', baseHash: null });
  });

  it('GET thiếu contentHash thì tự tính sha256 của nội dung', async () => {
    const { api, calls } = fakeApi({ current: 'cũ\n', contentHash: false });
    await putInstructions(api, AGENT, 'mới\n');
    expect(calls[1]?.body).toEqual({ path: 'AGENTS.md', content: 'mới\n', baseHash: sha('cũ\n') });
  });

  it('lỗi khác (403, 422, mạng) thì ném nguyên lỗi', async () => {
    await expect(
      putInstructions(fakeApi({ current: 'a', putError: new HttpError(422, 'base required') }).api, AGENT, 'b'),
    ).rejects.toThrow('base required');
    await expect(
      putInstructions(fakeApi({ getError: new HttpError(403, 'forbidden') }).api, AGENT, 'b'),
    ).rejects.toThrow('forbidden');
  });
});
