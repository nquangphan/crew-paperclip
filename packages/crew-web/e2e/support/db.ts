// Truy vấn chỉ đọc DB prod để kiểm tác dụng thật. SQL đi qua stdin của ssh (không nằm trong chuỗi lệnh), psql chạy
// trong container db với default_transaction_read_only=on. Chỉ nhận câu SELECT/WITH; tham số $1..$n ghép an toàn.
import { spawn } from 'node:child_process';
import { isProd } from './env';

export type SqlParam = string | number | boolean | null | Date;

const SSH_HOST = process.env.CREW_E2E_SSH_HOST ?? 'nhamoiplatform';
const DB_CONTAINER = 'crew-v3-spike-db-1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function literal(v: SqlParam): string {
  if (v === null) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('Tham số số không hữu hạn');
    return String(v);
  }
  const s = v instanceof Date ? v.toISOString() : v;
  if (s.includes('\0')) throw new Error('Tham số chứa NUL');
  if (UUID_RE.test(s)) return `'${s.toLowerCase()}'`;
  return `'${s.replaceAll("'", "''")}'`;
}

// psql chạy bằng superuser nên read-only không chặn hàm có tác dụng phụ (pg_terminate_backend, set_config, setval...).
const FORBIDDEN_CALL =
  /\b(pg_[a-z_0-9]+|lo_[a-z_0-9]+|dblink[a-z_0-9]*|set_config|nextval|setval|txid_[a-z_0-9]+)"?\s*\(/i;

function assertNoServerFunctions(sql: string): void {
  const m = FORBIDDEN_CALL.exec(sql.replace(/'(?:[^']|'')*'/g, "''"));
  if (m) throw new Error(`db.query từ chối hàm ${m[1]}`);
}

/** Thay $n bằng literal; không thay $n nằm trong chuỗi '...' của câu SQL gốc. */
export function formatSql(sql: string, params: SqlParam[] = []): string {
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(trimmed)) throw new Error('db.query chỉ nhận câu SELECT');
  if (trimmed.includes(';')) throw new Error('db.query chỉ nhận một câu lệnh');
  assertNoServerFunctions(trimmed);
  let out = '';
  let inStr = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "'") inStr = !inStr;
    if (!inStr && ch === '$' && /\d/.test(trimmed[i + 1] ?? '')) {
      let j = i + 1;
      while (/\d/.test(trimmed[j] ?? '')) j++;
      const n = Number(trimmed.slice(i + 1, j));
      if (n < 1 || n > params.length) throw new Error(`Thiếu tham số $${n}`);
      out += literal(params[n - 1]);
      i = j - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Tách CSV (RFC 4180) của `psql --csv` thành các dòng object theo header. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...data] = rows;
  if (!header) return [];
  return data.map((r) => Object.fromEntries(header.map((h, k) => [h, r[k] ?? ''])));
}

function runPsql(sql: string): Promise<string> {
  if (!isProd()) {
    return Promise.reject(new Error('db.query chỉ có ở T2/T3 (prod); T1 kiểm tác dụng bằng API'));
  }
  const remote = [
    'docker exec -i -e PGOPTIONS=-cdefault_transaction_read_only=on',
    DB_CONTAINER,
    `sh -c 'psql -X -q --csv -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`,
  ].join(' ');
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [SSH_HOST, remote], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`psql lỗi (${code}): ${err.trim().slice(0, 400)}`));
    });
    child.stdin.end(`${sql};\n`);
  });
}

export const db = {
  async query(sql: string, params: SqlParam[] = []): Promise<Record<string, string>[]> {
    return parseCsv(await runPsql(formatSql(sql, params)));
  },
};
