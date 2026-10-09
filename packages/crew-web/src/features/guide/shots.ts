// Danh sách ảnh minh họa của hướng dẫn. Ảnh chụp sau khi deploy bằng Playwright rồi lưu thành `img/<id>.png`.
// Chưa có file thì trang hiện khung chỗ kèm chú thích (locale `shots.<id>`).

export interface GuideShot {
  id: string;
  /** Trang cần chụp, tương đối dưới /:companyPrefix/. */
  route: string;
}

export const GUIDE_SHOTS: readonly GuideShot[] = [
  { id: 'login', route: 'dashboard' },
  { id: 'dashboard', route: 'dashboard' },
  { id: 'new-issue', route: 'issues?new=1' },
  { id: 'issue-detail', route: 'issues' },
  { id: 'inbox', route: 'inbox' },
  { id: 'projects', route: 'projects' },
  { id: 'add-project', route: 'projects/new' },
  { id: 'agents', route: 'agents' },
  { id: 'add-agent', route: 'agents/new' },
  { id: 'skills', route: 'skills' },
  { id: 'machines', route: 'machines' },
  { id: 'docs', route: 'docs' },
  { id: 'settings', route: 'settings' },
];
