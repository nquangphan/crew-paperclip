// Mockup TPS-750: dựng dòng danh sách, thẻ board và nhãn máy từ dữ liệu mẫu. Chỉ để vẽ mockup, không phải code app.
// Icon: path SVG chép từ lucide-react 1.38.0 (bộ icon app đang dùng, packages/crew-web/package.json).

const ICON = {
  wifiOff: '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
  unlink: '<path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71"/><path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71"/><line x1="8" x2="8" y1="2" y2="5"/><line x1="2" x2="5" y1="8" y2="8"/><line x1="16" x2="16" y1="19" y2="22"/><line x1="19" x2="22" y1="16" y2="16"/>',
  search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
  filter: '<path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"/>',
  columns: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  sort: '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
  layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
  list: '<path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/>',
  kanban: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 7v7"/><path d="M12 7v4"/><path d="M16 7v9"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};
const icon = (name, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

// StatusGlyph (ds/widgets/status-glyph.tsx): màu --status-task-icon-*.
const GLYPH = {
  backlog: '<circle cx="12" cy="12" r="10" stroke-dasharray="3 3"/>',
  todo: '<circle cx="12" cy="12" r="10"/>',
  in_progress: '<circle cx="12" cy="12" r="10" pathLength="100" stroke-dasharray="80 20"/>',
  in_review: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>',
  done: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  blocked: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>',
};
const STATUS_VI = { backlog: 'Tồn đọng', todo: 'Cần làm', in_progress: 'Đang làm', in_review: 'Đang duyệt', done: 'Xong', blocked: 'Bị chặn' };
const glyph = (s, size = 14) =>
  `<svg class="i" style="width:${size}px;height:${size}px;color:var(--status-task-icon-${s})" viewBox="0 0 24 24" role="img" aria-label="${STATUS_VI[s]}">${GLYPH[s]}</svg>`;

// ── Máy mẫu. Tên hiện = hostname máy báo, bỏ hậu tố miền (".local", ".tail1234.ts.net"). ──
const MACHINES = {
  mini: { host: 'phans-mac-mini', full: 'phans-mac-mini.local', state: 'online' },
  mbp: { host: 'phans-macbook-pro', full: 'phans-macbook-pro.local', state: 'offline', since: '14:02 05/11' },
  imac: { host: 'quang-imac', full: 'quang-imac.local', state: 'unpaired', since: '09:40 04/11' },
};
const STATE_VI = { online: 'đang kết nối', offline: 'mất liên lạc', unpaired: 'đã gỡ ghép' };

/** Nội dung tooltip: tên đầy đủ máy báo + trạng thái + gợi ý vì sao issue đứng. */
function tipText(m) {
  if (!m) return 'Cây yêu cầu này chưa ghim máy. Lượt chạy đầu tiên sẽ ghim máy còn trống.';
  if (m.state === 'online') return `<b>${m.full}</b><br>Đang kết nối. Mọi yêu cầu trong cây chạy trên máy này.`;
  if (m.state === 'offline') return `<b>${m.full}</b><br>Mất liên lạc từ ${m.since}. Yêu cầu trong cây chờ máy này trở lại.`;
  return `<b>${m.full}</b><br>Máy đã gỡ ghép lúc ${m.since}. Yêu cầu trong cây không chạy được cho tới khi ghim máy khác.`;
}

/**
 * Nhãn máy. `withState`: thêm chữ trạng thái sau tên máy (màn hẹp, thẻ board, bộ lọc) vì ở đó không có tooltip
 * hoặc có đủ chỗ. `unpinned`: 'text' hiện "Chưa ghim", 'none' không hiện gì.
 */
function machineLabel(key, { withState = false, unpinned = 'none' } = {}) {
  const m = key ? MACHINES[key] : null;
  if (!m) {
    if (unpinned === 'none') return '';
    return `<span class="ml unpinned" title="${tipText(null)}">Chưa ghim</span>`;
  }
  const ind =
    m.state === 'online' ? '<i></i>' : m.state === 'offline' ? icon('wifiOff') : icon('unlink');
  const aria = `Máy ${m.host}, ${STATE_VI[m.state]}`;
  return `<span class="ml ${m.state}${withState ? ' with-state' : ''}" aria-label="${aria}" title="${m.full} · ${STATE_VI[m.state]}"><span class="ind" aria-hidden="true">${ind}</span><span class="host" aria-hidden="true">${m.host}</span>${m.state === 'online' ? '' : `<span class="st" aria-hidden="true">${STATE_VI[m.state]}</span>`}</span>`;
}

// ── Yêu cầu mẫu: con lấy máy của gốc (cùng luật pinnedMachineOfIssue). ──
const ISSUES = [
  { id: 'TPS-750', title: '[crew-web] Danh sách issue và board hiện máy đang chạy issue', status: 'in_progress', m: 'mini', stage: 'Thiết kế', who: 'Trợ Lý', time: '3 phút', live: true, progress: '0/4 con xong',
    children: [
      { id: 'TPS-751', title: 'UIUX: nhãn máy trên danh sách issue và thẻ board', status: 'in_progress', m: 'mini', who: 'UIUX paperclip', time: '1 phút', live: true },
      { id: 'TPS-752', title: 'Route lô issue → máy cho danh sách', status: 'todo', m: 'mini', who: 'Executor 1', time: '12 phút' },
    ] },
  { id: 'TPS-723', title: 'Bug Finding kẹt khi chạy lại vòng sửa', status: 'blocked', m: 'mbp', stage: 'Làm code', who: 'Executor 2', time: '48 phút', progress: '1/3 con xong',
    children: [{ id: 'TPS-725', title: 'Sửa callback Bug Finding qua cầu nối crew.core', status: 'in_progress', m: 'mbp', who: 'Executor 2', time: '52 phút' }] },
  { id: 'TPS-693', title: 'E2E luồng ticket tổng root-bf', status: 'todo', m: 'imac', stage: 'Kiểm thử', who: 'Executor 3', time: '2 giờ' },
  { id: 'TPS-760', title: 'Sửa lỗi chính tả trang hướng dẫn', status: 'backlog', m: null, stage: 'Chờ', who: '', time: '5 giờ' },
  { id: 'TPS-741', title: 'Wizard thêm project tạo luôn agent UIUX', status: 'in_review', m: 'mini', stage: 'Review', who: 'Reviewer', time: '1 ngày' },
];

const av = (name) => name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

/** Một dòng danh sách (IssueListRow). `opts.machineCell`: hàm vẽ ô cột Máy (mặc định nhãn máy). */
function row(it, depth, hasKids, opts = {}) {
  const guides = '<span class="guide"></span>'.repeat(depth);
  const tw = hasKids ? `<span class="tw open">${icon('chevron')}</span>` : '<span class="tw"></span>';
  const cellMachine = opts.machineCell ? opts.machineCell(it) : machineLabel(it.m, { unpinned: 'text' });
  const mobileMachine = it.m ? machineLabel(it.m, { withState: true }) : '';
  return `<div class="row${opts.hover === it.id ? ' hover' : ''}" data-id="${it.id}">
    <span class="lead">${guides}${tw}${glyph(it.status)}</span>
    <span class="body">
      <span class="titleline"><span class="t">${it.title}</span>${it.progress && !depth ? '' : ''}<span class="time-m">${it.time}</span></span>
      ${mobileMachine ? `<span class="subline">${mobileMachine}</span>` : ''}
    </span>
    <span class="trail">
      ${it.live ? '<span class="live"><i></i><b>Đang chạy</b></span>' : ''}
      <span class="cell lg">${it.stage ? `<span class="stage">${it.stage}</span>` : ''}</span>
      <span class="cell lg mcell">${cellMachine}</span>
      <span class="cell lg">${it.who ? `<span class="who"><span class="av">${av(it.who)}</span><span>${it.who}</span></span>` : ''}</span>
      <span class="cell id">${it.id}</span>
      <span class="cell time">${it.time} trước</span>
    </span>
  </div>`;
}

function rows(list, opts) {
  return list
    .map((it) => row(it, 0, !!it.children, opts) + (it.children || []).map((c) => row(c, 1, false, opts)).join(''))
    .join('');
}

const colHead = () =>
  `<div class="colhead" aria-hidden="true"><span class="sp"></span><span class="cell lg">Giai đoạn Crew</span><span class="cell lg new">Máy (mới)</span><span class="cell lg">Người làm</span><span class="cell id">Mã</span><span class="cell time">Cập nhật</span></div>`;

function frame(content, active = 'issues') {
  return `<div class="frame">
    <aside class="side"><div class="brand">2P Crew</div>
      <a href="#">Tổng quan</a><a href="#" class="${active === 'issues' ? 'on' : ''}">Yêu cầu</a><a href="#">Agent</a><a href="#">Máy</a><a href="#">Project</a></aside>
    <div class="topbar"><span class="burger" aria-label="Mở menu">☰</span>2P Crew</div>
    <main class="main">${content}</main></div>`;
}

function toolbar({ board = false, filterCount = 0, popover = '' } = {}) {
  return `<h1 class="title">Yêu cầu</h1>
  <div class="toolbar" role="toolbar" aria-label="Thanh công cụ yêu cầu">
    <span class="btn">${icon('plus')}<span class="lbl">Yêu cầu mới</span></span>
    <span class="search">${icon('search')}<input placeholder="Tìm yêu cầu…" aria-label="Tìm yêu cầu"></span>
    <span class="controls">
      <span class="toggle" role="group" aria-label="Kiểu xem"><span class="${board ? '' : 'on'}">${icon('list')}</span><span class="${board ? 'on' : ''}">${icon('kanban')}</span></span>
      <span class="ib" title="Cột">${icon('columns')}</span>
      <span class="ib${filterCount ? ' on' : ''}" title="Lọc">${icon('filter')}${filterCount ? `<span class="badge">${filterCount}</span>` : ''}</span>
      ${board ? '' : `<span class="ib" title="Sắp xếp">${icon('sort')}</span><span class="ib" title="Nhóm">${icon('layers')}</span>`}
      ${popover}
    </span>
  </div>`;
}

/** Thẻ board (KanbanCardView) với dòng máy cuối thẻ. */
function card(it) {
  const ml = it.m ? `<div class="mline">${machineLabel(it.m, { withState: true })}</div>` : '';
  return `<div class="card">
    <div class="top"><span class="mono">${it.id}</span>${it.live ? '<span class="live-dot" title="Đang chạy"></span>' : ''}</div>
    <p>${it.title}</p>
    <div class="foot">${it.who ? `<span class="who"><span class="av">${av(it.who)}</span><span>${it.who}</span></span>` : ''}${it.stage ? `<span class="stage">${it.stage}</span>` : ''}${it.progress ? `<span class="note">${it.progress}</span>` : ''}</div>
    ${ml}
  </div>`;
}

const flat = () => ISSUES.flatMap((i) => [i, ...(i.children || [])]);
