// Chép chữ từ terminal web: tmux trên Mac gửi vùng chọn ra ngoài bằng OSC 52, addon clipboard của xterm ghi nó vào
// clipboard của trình duyệt.
import type { IClipboardProvider } from '@xterm/addon-clipboard';

/**
 * Chỉ ghi, không đọc: OSC 52 cũng cho chương trình trên Mac hỏi nội dung clipboard, mà trong đó có thể là mật khẩu
 * owner vừa chép ở tab khác. Nhận clipboard hệ thống: `c`, hoặc rỗng như tmux gửi (`]52;;<base64>`, xterm coi rỗng là
 * mặc định); bỏ PRIMARY (`p`) và loại khác. Trình duyệt từ chối ghi (tab mất focus, trang không
 * HTTPS) thì bỏ qua, owner vẫn chọn bằng Option+kéo rồi Cmd+C được.
 */
export const writeOnlyClipboard: IClipboardProvider = {
  readText: () => '',
  writeText: async (selection, text) => {
    if (selection !== 'c' && (selection as string) !== '') return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // trình duyệt không cho ghi lúc này
    }
  },
};
