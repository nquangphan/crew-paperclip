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
}

export type RoadmapEdgeKind = 'parent' | 'blocks';

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
  /** `rings`: vòng đồng tâm quanh tâm; `tree`: cây tỏa tròn theo `parentId`. */
  layout: 'rings' | 'tree';
}

export interface RoadmapPoint {
  x: number;
  y: number;
}
