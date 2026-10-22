# Vá adapter claude_local, codex_local, opencode_local

> Flow `adapter-patches`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow adapter-patches` in ra đúng danh sách đó.

## Mục đích

Crew dùng ba adapter gốc của Paperclip để chạy agent trên Mac qua SSH. Ba chỗ adapter gốc không hợp với cách Crew chạy,
nên Crew vá nhỏ trong chính adapter (khai trong `crew/release/core-hooks.json`, loại `adapter-patch`, mỗi vá có test
riêng đuôi `.crew.test.ts`):

- Chạy tại chỗ (P2 `claude_local`, P6 `opencode_local`): với lease `in_place`, adapter chạy ở thư mục gốc trên Mac và bỏ
  bước chép workspace lên/về, giống `codex_local` gốc. OpenCode còn bỏ bước chép skill vào `$HOME/.claude/skills` trên
  máy remote.
- Giữ danh tính thực thi remote trong session (P3, P5, P7): `sessionCodec` của cả ba adapter giữ `remoteExecution` khi
  serialize/deserialize, để run SSH sau nối lại được phiên Claude/Codex/OpenCode (cần cho nối phiên trong gói và chuyển
  runtime).
- Bỏ log sai (P4): không in thông báo "lệch cwd, mở phiên mới" khi phiên thực ra được nối lại.
- Phân loại lỗi đăng nhập Claude (P9): kết quả `success` với `is_error` false không bao giờ bị gắn
  `claude_auth_required`, và dấu hiệu đòi đăng nhập chỉ được so với output của chính Claude (kết quả, lỗi, stderr, dòng
  stdout dạng văn bản, sự kiện assistant có cờ lỗi), không so với output của tool. Gắn nhầm làm hiện thẻ sửa đăng nhập,
  chặn chạy lại và kích hoạt chuyển runtime.

Lý do chi tiết từng vá nằm ở trường `description` của mục tương ứng trong `crew/release/core-hooks.json`.

## Điểm vào

- Adapter được heartbeat của lõi gọi cho mỗi run (`execute`), và lõi gọi `sessionCodec` khi lưu/đọc tham số session.
- Lease SSH mang `workspaceRealization.mode = "in_place"` do vá P1 đặt (flow `ssh-run-lifecycle`).

## Các bước

1. `packages/adapters/claude-local/src/server/execute.ts` → `execute` (`inPlaceRoot`): P2 chạy ở thư mục gốc khi
   `executionTarget.workspaceRealization.mode === "in_place"`; P4 bỏ log mở phiên mới khi phiên được nối.
2. `packages/adapters/opencode-local/src/server/execute.ts` → `execute` (`inPlaceRoot`): P6, cùng ý với P2.
3. `packages/adapters/claude-local/src/server/index.ts`, `packages/adapters/codex-local/src/server/index.ts`,
   `packages/adapters/opencode-local/src/server/index.ts` → `sessionCodec.serialize`, `sessionCodec.deserialize`: P3, P5,
   P7 giữ `remoteExecution`. OpenCode nhận cả khóa `sessionID` của nó.
4. `packages/adapters/claude-local/src/server/parse.ts` → `detectClaudeLoginRequired`: P9 trả `requiresLogin: false`
   ngay khi `isClaudeSuccessResult`, và chỉ quét dấu hiệu đăng nhập trong output của Claude. Run vẫn có thể kết thúc
   `failed` theo luật gốc; chỉ nhãn đăng nhập bị bỏ.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `packages/adapters/claude-local/src/server/execute.ts` | P2, P4 | `execute` |
| `packages/adapters/claude-local/src/server/index.ts` | P3 | `sessionCodec` |
| `packages/adapters/claude-local/src/server/parse.ts` | P9 | `detectClaudeLoginRequired`, `isClaudeSuccessResult` |
| `packages/adapters/codex-local/src/server/index.ts` | P5 | `sessionCodec` |
| `packages/adapters/opencode-local/src/server/execute.ts` | P6 | `execute` |
| `packages/adapters/opencode-local/src/server/index.ts` | P7 | `sessionCodec` |

## Dữ liệu

- Không có bảng riêng. Tham số session (gồm `remoteExecution`) được lõi lưu trong task session và `heartbeat_runs`.
- Gọi ngoài: CLI `claude`, `codex`, `opencode` trên Mac qua SSH (do adapter gốc thực hiện).
- Mã lỗi liên quan: `claude_auth_required` (P9).

## Flow liên quan

- `core-hooks`: sổ đăng ký vá và `verify.sh` chạy các test `.crew.test.ts` khi nâng upstream.
- `ssh-run-lifecycle`: vá P1 đặt chế độ `in_place` cho lease.
- `run-claim`: nối phiên trong gói cần session giữ `remoteExecution`.
- `runtime-fallback`: nhãn `claude_auth_required` là đầu vào phân loại lỗi `auth`.

## Tests

- `packages/adapters/claude-local/src/server/execute.remote.crew.test.ts`: chạy tại chỗ không upload/restore; nối lại
  phiên SSH đã qua codec; không log mở phiên mới khi nối được.
- `packages/adapters/claude-local/src/server/parse.auth.crew.test.ts`: không gắn nhãn đăng nhập khi output tool có chữ
  Unauthorized (kể cả run thoát 255 sau kết quả); vẫn gắn khi Claude thật sự đòi `/login`, token hết hạn, hay sự kiện lỗi
  của CLI.
- `packages/adapters/claude-local/src/server/session-codec.crew.test.ts`,
  `packages/adapters/codex-local/src/server/session-codec.crew.test.ts`,
  `packages/adapters/opencode-local/src/server/session-codec.crew.test.ts`: giữ `remoteExecution` qua serialize và
  deserialize, bỏ khi phiên local hay giá trị không phải object.
- `packages/adapters/opencode-local/src/server/execute.in-place.crew.test.ts`: chạy tại chỗ; không `in_place` thì giữ
  đồng bộ workspace và chép skill như gốc; nối lại phiên.
