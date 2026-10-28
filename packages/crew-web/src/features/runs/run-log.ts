// crew: tự dựng
/**
 * Log run dạng dễ đọc. Log là NDJSON `{ts, stream, chunk}`; stdout của agent Claude là stream-json (mỗi dòng một sự
 * kiện `system`/`assistant`/`user`/`result`), của agent Codex là `codex exec --json` (`item.completed`…). Hàm đổi mỗi
 * sự kiện thành một khối chữ có giờ: lời agent, công cụ gọi kèm tham số chính, kết quả rút gọn, dòng kết thúc. Sự kiện
 * nhiễu (thinking, đếm token, hook, rate limit) bị bỏ. Dòng không phải JSON (thông báo của Paperclip, stderr) giữ nguyên.
 * Hàm thuần.
 */

const RESULT_MAX_LINES = 12;
const RESULT_MAX_CHARS = 1500;
const INPUT_MAX_CHARS = 300;

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Giờ `HH:MM:SS` theo Asia/Ho_Chi_Minh; ts không đọc được thì bỏ. */
function clock(ts: string | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… (+${text.length - max} ký tự)` : text;
}

/** Rút gọn kết quả công cụ: tối đa vài dòng đầu, ghi số dòng bị ẩn. */
function shorten(text: string): string {
  const lines = text.replace(/\s+$/, '').split('\n');
  const head = lines.slice(0, RESULT_MAX_LINES).join('\n');
  const more = lines.length - RESULT_MAX_LINES;
  return clip(head, RESULT_MAX_CHARS) + (more > 0 ? `\n… (+${more} dòng)` : '');
}

const indent = (text: string, pad = '    ') => text.replace(/^/gm, pad);

/** Tham số chính của một lần gọi công cụ Claude. */
function toolArgs(name: string, input: unknown): string {
  if (!isObj(input)) return '';
  const pick =
    str(input.command) ??
    str(input.file_path) ??
    str(input.notebook_path) ??
    str(input.pattern) ??
    str(input.url) ??
    str(input.query) ??
    str(input.skill) ??
    str(input.description) ??
    str(input.prompt);
  if (pick !== undefined) {
    const extra = name === 'Bash' && str(input.description) ? `  # ${input.description}` : '';
    return clip(pick, INPUT_MAX_CHARS) + extra;
  }
  return clip(JSON.stringify(input), INPUT_MAX_CHARS);
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (isObj(part) ? (str(part.text) ?? (part.type === 'image' ? '[ảnh]' : '')) : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function seconds(ms: unknown): string {
  return typeof ms === 'number' ? `${Math.round(ms / 1000)}s` : '';
}

/** Một sự kiện stream-json của Claude hoặc `--json` của Codex → các khối chữ; `null` = không nhận ra định dạng. */
function describe(event: Json): string[] | null {
  const type = str(event.type);
  if (type === 'system') {
    if (event.subtype === 'init') {
      const model = str(event.model) ?? '';
      const cwd = str(event.cwd) ?? '';
      return [`▶ Bắt đầu${model ? ` · model ${model}` : ''}${cwd ? ` · ${cwd}` : ''}`];
    }
    return [];
  }
  if (type === 'assistant' && isObj(event.message) && Array.isArray(event.message.content)) {
    const out: string[] = [];
    for (const part of event.message.content) {
      if (!isObj(part)) continue;
      if (part.type === 'text' && str(part.text)?.trim()) out.push(`Agent: ${(part.text as string).trim()}`);
      if (part.type === 'tool_use') {
        const name = str(part.name) ?? '?';
        out.push(`→ ${name}: ${toolArgs(name, part.input)}`);
      }
    }
    return out;
  }
  if (type === 'user' && isObj(event.message) && Array.isArray(event.message.content)) {
    const out: string[] = [];
    for (const part of event.message.content) {
      if (!isObj(part) || part.type !== 'tool_result') continue;
      const text = shorten(resultText(part.content));
      const mark = part.is_error === true ? '  ✗ lỗi' : '  ↳';
      out.push(text ? `${mark}\n${indent(text)}` : `${mark} (không có kết quả)`);
    }
    return out;
  }
  if (type === 'result') {
    const parts = [str(event.subtype) ?? '', seconds(event.duration_ms)];
    if (typeof event.num_turns === 'number') parts.push(`${event.num_turns} lượt`);
    if (typeof event.total_cost_usd === 'number') parts.push(`$${event.total_cost_usd.toFixed(2)}`);
    const head = `■ Kết thúc${event.is_error === true ? ' (lỗi)' : ''} · ${parts.filter(Boolean).join(' · ')}`;
    const text = str(event.result)?.trim();
    return [text ? `${head}\n${indent(text)}` : head];
  }
  if (type === 'rate_limit_event' || type === 'stream_event') return [];
  // Codex `exec --json`.
  if (type === 'thread.started' || type === 'turn.started' || type === 'item.started' || type === 'item.updated') {
    return [];
  }
  if (type === 'turn.completed') return ['■ Hết lượt'];
  if (type === 'turn.failed' || type === 'error') {
    const message = isObj(event.error) ? str(event.error.message) : str(event.message);
    return [`✗ Lỗi${message ? `: ${message}` : ''}`];
  }
  if (type === 'item.completed' && isObj(event.item)) {
    const item = event.item;
    if (item.type === 'agent_message' && str(item.text)) return [`Agent: ${(item.text as string).trim()}`];
    if (item.type === 'reasoning') return [];
    if (item.type === 'command_execution') {
      const exit = typeof item.exit_code === 'number' && item.exit_code !== 0 ? `  ✗ exit ${item.exit_code}` : '  ↳';
      const output = shorten(str(item.aggregated_output) ?? '');
      return [
        `→ shell: ${clip(str(item.command) ?? '', INPUT_MAX_CHARS)}`,
        output ? `${exit}\n${indent(output)}` : exit,
      ];
    }
    if (item.type === 'file_change' && Array.isArray(item.changes)) {
      const files = item.changes.map((c) => (isObj(c) ? `${str(c.kind) ?? ''} ${str(c.path) ?? ''}`.trim() : ''));
      return [`→ sửa file: ${files.filter(Boolean).join(', ')}`];
    }
    if (item.type === 'mcp_tool_call') return [`→ ${str(item.server) ?? ''}.${str(item.tool) ?? ''}`];
    return [];
  }
  return null;
}

/**
 * Ghép chunk theo từng stream (một dòng JSON có thể bị cắt qua nhiều chunk), rồi đổi từng dòng hoàn chỉnh thành chữ.
 * Dòng JSON lạ giữ nguyên để không mất thông tin.
 */
export function readableRunLog(content: string | undefined): string {
  if (!content) return '';
  const blocks: string[] = [];
  const pending: Record<string, string> = {};
  const emit = (line: string, ts: string | undefined) => {
    if (!line.trim()) return;
    const time = clock(ts);
    const prefix = time ? `[${time}] ` : '';
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      blocks.push(prefix + line);
      return;
    }
    const described = isObj(event) ? describe(event) : null;
    if (described === null) blocks.push(prefix + line);
    else for (const block of described) blocks.push(prefix + block);
  };
  for (const raw of content.split('\n')) {
    if (!raw) continue;
    let record: unknown;
    try {
      record = JSON.parse(raw);
    } catch {
      emit(raw, undefined);
      continue;
    }
    if (!isObj(record) || typeof record.chunk !== 'string') {
      emit(raw, undefined);
      continue;
    }
    const stream = str(record.stream) ?? 'stdout';
    const ts = str(record.ts);
    const lines = ((pending[stream] ?? '') + record.chunk).split('\n');
    pending[stream] = lines.pop() ?? '';
    for (const line of lines) emit(line, ts);
  }
  for (const rest of Object.values(pending)) emit(rest, undefined);
  return blocks.join('\n');
}
