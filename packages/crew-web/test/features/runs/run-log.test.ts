import { describe, expect, it } from 'vitest';
import { readableRunLog } from '@/features/runs/run-log';

// Nguồn: log run NDJSON `{ts, stream, chunk}` (server heartbeat run-log store); stdout agent Claude là
// `claude --output-format stream-json`, agent Codex là `codex exec --json`.
const rec = (chunk: string, stream = 'stdout', ts = '2026-10-28T14:23:04.000Z') =>
  JSON.stringify({ ts, stream, chunk });
const line = (event: unknown) => `${JSON.stringify(event)}\n`;

describe('readableRunLog', () => {
  it('đổi sự kiện Claude thành chữ có giờ, bỏ sự kiện nhiễu', () => {
    const content = [
      rec('[paperclip] Syncing Claude runtime assets.\n'),
      rec(line({ type: 'system', subtype: 'init', model: 'claude-sonnet-5-5', cwd: '/w' })),
      rec(line({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 50 })),
      rec(line({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }] } })),
      rec(line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Đang đọc repo.' }] } })),
      rec(
        line({
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git status', description: 'Xem cây' } }],
          },
        }),
      ),
      rec(line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'sạch\n' }] } })),
      rec(line({ type: 'rate_limit_event' })),
      rec(
        line({
          type: 'result',
          subtype: 'success',
          duration_ms: 61000,
          num_turns: 3,
          total_cost_usd: 0.5,
          result: 'Xong.',
        }),
      ),
    ].join('\n');
    expect(readableRunLog(content)).toBe(
      [
        '[21:23:04] [paperclip] Syncing Claude runtime assets.',
        '[21:23:04] ▶ Bắt đầu · model claude-sonnet-5-5 · /w',
        '[21:23:04] Agent: Đang đọc repo.',
        '[21:23:04] → Bash: git status  # Xem cây',
        '[21:23:04]   ↳\n    sạch',
        '[21:23:04] ■ Kết thúc · success · 61s · 3 lượt · $0.50\n    Xong.',
      ].join('\n'),
    );
  });

  it('ghép dòng JSON bị cắt qua nhiều chunk; kết quả lỗi và dài bị rút gọn', () => {
    const event = line({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', is_error: true, content: [{ type: 'text', text: Array(20).fill('x').join('\n') }] },
        ],
      },
    });
    const content = [rec(event.slice(0, 30)), rec(event.slice(30))].join('\n');
    expect(readableRunLog(content)).toBe(`[21:23:04]   ✗ lỗi\n${Array(12).fill('    x').join('\n')}\n    … (+8 dòng)`);
  });

  it('đọc được sự kiện Codex; dòng JSON lạ và dòng thô giữ nguyên', () => {
    const content = [
      rec(line({ type: 'thread.started', thread_id: 't' })),
      rec(line({ type: 'item.completed', item: { type: 'agent_message', text: 'Chào' } })),
      rec(
        line({
          type: 'item.completed',
          item: { type: 'command_execution', command: 'ls', aggregated_output: 'a\n', exit_code: 2 },
        }),
      ),
      rec('{"khac":1}\n', 'stderr'),
      'dòng thô',
    ].join('\n');
    expect(readableRunLog(content)).toBe(
      [
        '[21:23:04] Agent: Chào',
        '[21:23:04] → shell: ls',
        '[21:23:04]   ✗ exit 2\n    a',
        '[21:23:04] {"khac":1}',
        'dòng thô',
      ].join('\n'),
    );
  });

  it('rỗng thì trả chuỗi rỗng', () => {
    expect(readableRunLog(undefined)).toBe('');
  });
});
