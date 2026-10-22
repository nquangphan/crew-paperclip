// crew: tự dựng
// Kiểu dữ liệu của bản đồ Roadmap. Feature dựng một tầng (`RoadmapLevel`), canvas trong ds tự bố cục và vẽ.

/** Loại nút: công ty, project, yêu cầu gốc, việc con, bộ docs, thư mục docs, trang docs, nút "+N khác". */
export type RoadmapNodeKind = 'company' | 'project' | 'request' | 'ticket' | 'docs' | 'folder' | 'page' | 'more';

export interface RoadmapNode {
  /** Duy nhất trong một tầng. */
  id: string;
  kind: RoadmapNodeKind;
  /** Tên project/công ty/thư mục hoặc tiêu đề yêu cầu/trang. */
  title: string;
  /** Mã yêu cầu (TPS-12). */
  identifier?: string | null;
  /** Trạng thái issue (yêu cầu, việc con). */
  status?: string | null;
  /** Màu project (dữ liệu của project); không có thì dùng màu chính của theme. */
  color?: string | null;
  /** Đếm chính: số project (công ty), số yêu cầu (project), số việc con (yêu cầu), số trang (docs, thư mục). */
  total?: number;
  /** Số mục còn mở. */
  open?: number;
  /** Số việc con đã xong (yêu cầu). */
  done?: number;
  /** Số con trực tiếp (việc con). */
  children?: number;
  /** Tên người làm (việc con). */
  assignee?: string | null;
  /** Số mục bị cắt (nút "+N khác"). */
  extra?: number;
  /** Cha trong cây (tầng yêu cầu): id nút cha, hoặc id nút tâm. */
  parentId?: string | null;
  /** Nút không bấm được (ví dụ project chưa có docs). */
  disabled?: boolean;
  /** Dòng phụ tự do (đường dẫn trang docs). */
  subtitle?: string | null;
  /** Dòng chi tiết thêm dưới thẻ yêu cầu/việc con (bản đồ Crew: giai đoạn · vòng sửa). */
  detail?: string | null;
  /** Thông tin không vừa thẻ: hiện trong tooltip (title) và nối vào nhãn đọc màn hình. */
  notes?: readonly string[];
  /** Việc đang xem (bản đồ Crew ở trang chi tiết): viền nổi bật. */
  current?: boolean;
  /** Số lệnh Jev đã xét trong các run của việc (chỉ owner, khi có dữ liệu): huy hiệu "Jev" trên thẻ. */
  jev?: RoadmapJev;
  /** Run của việc (yêu cầu/việc con): vài dòng mới nhất trong thẻ, chân thẻ là tổng tiền và số run. */
  runs?: RoadmapRuns;
}

/** Số liệu Jev của một việc; `mismatch` là số ca lệch giữa nhãn Jev và regex (C3). */
export interface RoadmapJev {
  calls: number;
  deny: number;
  appliedDeny: number;
  escalate: number;
  error: number;
  mismatch: number;
}

/** Một run của việc, đủ để vẽ một dòng: trạng thái, agent, model, thời lượng, tiền. */
export interface RoadmapRun {
  id: string;
  /** Trạng thái run của Paperclip: queued, running, succeeded, failed, timed_out, cancelled… */
  status: string;
  agentName: string;
  /** Mã model (`claude-sonnet-5`); null khi chưa biết. */
  model: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** USD quy đổi giá API; null khi không có số liệu (hiện "—"). */
  costUsd: number | null;
}

/** Tổng run hiện ở chân thẻ. */
export interface RoadmapRunTotals {
  count: number;
  costUsd: number | null;
  /** Có run tính theo gói thuê bao: tiền là giá quy đổi, không bị trừ thật. */
  subscription: boolean;
}

export interface RoadmapRuns {
  /** Run của chính việc, mới nhất trước (thẻ vẽ tối đa `ROADMAP_RUN_LINES` dòng). */
  runs: readonly RoadmapRun[];
  /** Tổng số run của chính việc, có thể nhiều hơn `runs` (phần dư hiện "+N run"). */
  count: number;
  /** Chân thẻ: tổng của việc, hoặc của cả cây (`tree`) với yêu cầu gốc. */
  total: RoadmapRunTotals & { tree: boolean };
}

/** `repair`: vòng sửa của bản đồ Crew (việc được sửa → việc sửa; cùng nút = việc đã qua vòng sửa). */
export type RoadmapEdgeKind = 'parent' | 'blocks' | 'repair';

export interface RoadmapEdge {
  id: string;
  source: string;
  target: string;
  kind: RoadmapEdgeKind;
}

export interface RoadmapLevel {
  center: RoadmapNode;
  nodes: RoadmapNode[];
  edges: RoadmapEdge[];
  /** Số mục không vẽ vì vượt trần (đã có nút "+N khác" trong `nodes`). */
  overflow: number;
  /**
   * `rings`: vòng đồng tâm quanh tâm; `tree`: cây tỏa tròn theo `parentId`; `spread-tree`: cây tỏa tròn gọn trên các
   * elip dẹt ngang, nới dần tới khi không thẻ nào chồng lên nhau (khung nhỏ, cây rộng hoặc sâu); `top-down`: cây phân
   * tầng trên xuống theo `parentId` (gốc ở trên, con xếp hàng ngang dưới cha, dây nối từ đáy cha tới đỉnh con).
   */
  layout: 'rings' | 'tree' | 'spread-tree' | 'top-down';
}

export interface RoadmapPoint {
  x: number;
  y: number;
}
