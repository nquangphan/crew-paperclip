// Dữ liệu giả của mockup (chỉ để xem giao diện). Sinh cố định theo hạt giống nên ảnh chụp lần nào cũng giống nhau.
// `?n=nhieu` nhân số yêu cầu để thử vài trăm ticket.
(function () {
  const params = new URLSearchParams(location.search);
  const many = params.get('n') === 'nhieu';

  let seed = 696;
  const rnd = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

  const REQ = [
    'Trang Kanban kéo thả giữa cột', 'Báo cáo chi phí theo project', 'Đăng nhập bằng mã một lần', 'Trợ Lý trả lời trong thread',
    'Nhập giao dịch từ sao kê ngân hàng', 'Ngân sách tháng có cảnh báo', 'Hồ sơ căn hộ có ảnh 360', 'Lịch hẹn xem nhà',
    'Đồng bộ docs từ repo', 'Tìm kiếm toàn văn trong docs', 'Terminal web nhiều tab', 'Kiểm docs trước khi merge',
    'Phòng QC duyệt yêu cầu xong', 'Wizard tạo agent mới', 'Gắn nhãn ưu tiên cho issue', 'Thông báo khi run lỗi',
    'Xuất CSV danh sách việc', 'Biểu đồ tiền theo tuần', 'Chế độ tối cho trang công khai', 'Sửa lỗi phân trang danh sách',
    'Tách quyền xem project', 'Màn chọn máy chạy agent', 'Bản đồ chi phí theo agent', 'Giao diện điện thoại cho Crew',
  ];
  const KIND = [
    ['UIUX', 'Mockup %s'], ['Dữ liệu', 'API cho %s'], ['Giao diện', 'Màn %s'], ['Docs', 'Cập nhật flow %s'],
    ['Lập trình', '%s'], ['Kiểm thử', 'Test e2e %s'],
  ];
  const AGENTS = ['paperclip-executor-1', 'paperclip-executor-2', 'UIUX paperclip', 'paperclip-reviewer', 'paperclip-integrator', 'Trợ Lý'];
  const MODELS = ['opus', 'sonnet', 'haiku'];
  const STAGES = ['Thực hiện', 'Review · vòng 1', 'Review · vòng 2', 'Gộp code + PR', 'Owner duyệt', 'Merge'];

  let seq = 701; // mã giả bắt đầu sau các mã thật của TPS-696 để không trùng
  const nextId = () => `TPS-${seq++}`;

  function runsFor(status) {
    if (status === 'backlog' || status === 'todo') return null;
    const n = status === 'in_progress' ? int(1, 3) : int(1, 2);
    const runs = [];
    for (let i = 0; i < n; i++) {
      const running = status === 'in_progress' && i === 0;
      runs.push({
        status: running ? 'running' : rnd() < 0.12 ? 'failed' : 'succeeded',
        agent: pick(AGENTS), model: pick(MODELS), dur: running ? `${int(2, 18)}m` : `${int(3, 40)}m`,
        cost: rnd() < 0.08 ? null : (rnd() * 3 + 0.1),
      });
    }
    const count = n + (rnd() < 0.3 ? int(1, 4) : 0);
    return { runs, count, total: runs.reduce((s, r) => s + (r.cost ?? 0), 0) + (count - n) * 0.9 };
  }

  function childStatus(reqStatus) {
    if (reqStatus === 'done') return 'done';
    if (reqStatus === 'backlog') return pick(['backlog', 'backlog', 'todo']);
    return pick(['done', 'done', 'in_progress', 'in_review', 'todo', 'todo', 'backlog', 'blocked']);
  }

  function makeRequest(title, status) {
    const id = nextId();
    const n = int(2, 9);
    const children = [];
    const edges = [];
    for (let i = 0; i < n; i++) {
      const [k, f] = pick(KIND);
      const st = childStatus(status);
      const t = {
        id: nextId(), kind: 'ticket', title: `${k}: ${f.replace('%s', title.toLowerCase())}`, status: st,
        assignee: st === 'backlog' ? null : pick(AGENTS),
        detail: st === 'in_progress' || st === 'in_review' ? pick(STAGES) : null,
        runs: runsFor(st), children: [],
      };
      if (rnd() < 0.18 && st !== 'backlog') {
        const m = int(1, 2);
        for (let j = 0; j < m; j++) {
          const s2 = childStatus(status);
          t.children.push({ id: nextId(), kind: 'ticket', title: `Sửa: ${t.title.split(': ')[1]} (vòng ${j + 1})`, status: s2,
            assignee: pick(AGENTS), detail: null, runs: runsFor(s2), children: [] });
        }
        if (rnd() < 0.6) edges.push({ kind: 'repair', source: t.id, target: t.children[0].id });
      }
      children.push(t);
    }
    for (let i = 1; i < children.length; i++) {
      if (rnd() < 0.22) edges.push({ kind: 'blocks', source: children[i - 1].id, target: children[i].id });
    }
    const all = children.flatMap((c) => [c, ...c.children]);
    return {
      id, kind: 'request', title, status, children, edges,
      done: children.filter((c) => c.status === 'done').length, total: children.length,
      detail: status === 'in_progress' ? pick(STAGES) : null,
      runs: status === 'backlog' ? null : { runs: [], count: all.reduce((s, c) => s + (c.runs?.count ?? 0), 0),
        total: all.reduce((s, c) => s + (c.runs?.total ?? 0), 0), tree: true },
    };
  }

  // Yêu cầu mẫu thật: TPS-696 và các con của nó.
  function showcase() {
    const r = (id, title, status, assignee, detail, runs) => ({ id, kind: 'ticket', title, status, assignee, detail, runs, children: [] });
    const kids = [
      r('TPS-697', 'UIUX: Roadmap một trang, hiện mọi ticket, bấm để zoom', 'in_progress', 'UIUX paperclip', 'UIUX · vẽ mockup',
        { runs: [{ status: 'running', agent: 'UIUX paperclip', model: 'opus', dur: '14m', cost: 1.84 }], count: 1, total: 1.84 }),
      r('TPS-698', 'Dữ liệu: nạp cả cây công ty trong một lần gọi', 'in_progress', 'paperclip-executor-1', 'Thực hiện · SA đo hiệu năng',
        { runs: [{ status: 'running', agent: 'paperclip-executor-1', model: 'opus', dur: '9m', cost: 0.92 },
          { status: 'succeeded', agent: 'paperclip-executor-1', model: 'sonnet', dur: '21m', cost: 0.61 }], count: 2, total: 1.53 }),
      r('TPS-699', 'Giao diện: bản đồ một trang, zoom theo mức chi tiết', 'todo', 'paperclip-executor-2', null, null),
      r('TPS-700', 'Docs: cập nhật flow roadmap-map', 'backlog', null, null, null),
    ];
    return {
      id: 'TPS-696', kind: 'request', title: 'UI roadmap', status: 'in_progress', children: kids,
      edges: [
        { kind: 'blocks', source: 'TPS-697', target: 'TPS-699' },
        { kind: 'blocks', source: 'TPS-698', target: 'TPS-699' },
        { kind: 'blocks', source: 'TPS-699', target: 'TPS-700' },
      ],
      done: 0, total: 4, detail: 'Thiết kế · chờ owner duyệt mockup',
      runs: { runs: [], count: 3, total: 3.37, tree: true },
    };
  }
  function showcaseRepair() {
    const q = makeRequest('Trợ Lý trả lời trong thread', 'in_review');
    q.children[0].status = 'done';
    q.children[0].children = [{ id: nextId(), kind: 'ticket', title: 'Sửa: giữ khóa ghi khi con bị khóa', status: 'in_review',
      assignee: 'paperclip-reviewer', detail: 'Review · vòng 2', runs: { runs: [{ status: 'succeeded', agent: 'paperclip-reviewer', model: 'sonnet', dur: '6m', cost: 0.22 }], count: 1, total: 0.22 }, children: [] }];
    q.edges.push({ kind: 'repair', source: q.children[0].id, target: q.children[0].children[0].id });
    return q;
  }

  const PROJECTS = [
    { id: 'paperclip', name: 'paperclip', color: '#8b5cf6', n: 11, docs: true },
    { id: 'my-money', name: 'my-money', color: '#22c55e', n: 7, docs: true },
    { id: 'nha-moi', name: 'nha_moi_platform', color: '#f59e0b', n: 6, docs: false },
    { id: 'crew-docs', name: 'crew-docs', color: '#06b6d4', n: 4, docs: true },
    { id: 'none', name: 'Chưa gắn project', color: null, n: 2, docs: false },
  ];
  const REQ_STATUS = ['in_progress', 'in_progress', 'in_review', 'done', 'done', 'todo', 'backlog', 'blocked'];

  const projects = PROJECTS.map((p, pi) => {
    const count = many ? Math.round(p.n * 3.2) : p.n;
    const requests = [];
    for (let i = 0; i < count; i++) {
      if (pi === 0 && i === 0) { requests.push(showcase()); continue; }
      if (pi === 0 && i === 1) { requests.push(showcaseRepair()); continue; }
      requests.push(makeRequest(pick(REQ), pick(REQ_STATUS)));
    }
    const docs = p.docs ? {
      id: `docs:${p.id}`, kind: 'docs', title: 'Docs', total: int(14, 60),
      folders: [
        { id: `dir:${p.id}:flows`, kind: 'folder', title: 'flows', total: int(6, 30),
          pages: ['roadmap-map.md', 'design-system.md', 'issues-web.md'].map((t) => ({ id: `page:${p.id}:${t}`, kind: 'page', title: t, subtitle: `flows/${t}` })) },
        { id: `dir:${p.id}:design`, kind: 'folder', title: 'design', total: int(2, 9),
          pages: ['mockups.md'].map((t) => ({ id: `page:${p.id}:${t}`, kind: 'page', title: t, subtitle: `design/${t}` })) },
      ],
    } : null;
    const all = requests.flatMap((r) => r.children.flatMap((c) => [c, ...c.children]));
    return {
      id: p.id, kind: 'project', title: p.name, color: p.color, requests, docs,
      total: requests.length, open: requests.filter((r) => r.status !== 'done' && r.status !== 'cancelled').length,
      tickets: all.length, running: all.filter((t) => t.status === 'in_progress').length,
    };
  });
  const tickets = projects.reduce((s, p) => s + p.tickets, 0);
  window.ROADMAP_DATA = {
    company: { id: 'company', kind: 'company', title: '2P Crew', total: projects.length,
      open: projects.reduce((s, p) => s + p.open, 0), tickets,
      running: projects.reduce((s, p) => s + p.running, 0) },
    projects,
  };
})();
