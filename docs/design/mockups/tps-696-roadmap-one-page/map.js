// Mockup TPS-696: Roadmap một trang. Một thế giới chứa công ty → project → yêu cầu → việc con (và nhánh Docs); bấm một
// mục thì camera bay tới mục đó, không đổi trang. Mức chi tiết theo độ zoom (data-lod 0/1/2). Chỉ để duyệt giao diện:
// trong app phần này là xyflow (roadmap-flow.tsx), không phải DOM tự dựng.
(function () {
  const params = new URLSearchParams(location.search);
  const root = document.documentElement;
  if (params.get('theme') !== 'light') root.classList.add('dark');
  const reduced = params.get('rm') === '1' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) root.classList.add('rm');
  const STATE = params.get('state');
  const VIEW = params.get('view') === 'list' ? 'list' : 'map';
  const DATA = window.ROADMAP_DATA;

  // ── Icon lucide (cùng bộ với lucide-react của crew-web), vẽ nội tuyến ──
  const P = {
    circle: '<circle cx="12" cy="12" r="10"/>',
    backlog: '<path d="M10.1 2.182a10 10 0 0 1 3.8 0"/><path d="M13.9 21.818a10 10 0 0 1-3.8 0"/><path d="M17.609 3.721a10 10 0 0 1 2.69 2.7"/><path d="M2.182 13.9a10 10 0 0 1 0-3.8"/><path d="M20.279 17.609a10 10 0 0 1-2.7 2.69"/><path d="M21.818 10.1a10 10 0 0 1 0 3.8"/><path d="M3.721 6.391a10 10 0 0 1 2.7-2.69"/><path d="M6.391 20.279a10 10 0 0 1-2.69-2.7"/>',
    todo: '<circle cx="12" cy="12" r="10"/>',
    in_progress: '<circle cx="12" cy="12" r="10" pathLength="100" stroke-dasharray="80 20"/>',
    in_review: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>',
    done: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    blocked: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>',
    cancelled: '<circle cx="12" cy="12" r="10"/><path d="M4.929 4.929 19.07 19.071"/>',
    bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
    branch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    building: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    folderOpen: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
    book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    minus: '<path d="M5 12h14"/>',
    open: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    error: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  };
  const icon = (name, cls = '') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`;
  window.ICON = icon;

  const STATUS = { backlog: 'Nháp', todo: 'Cần làm', in_progress: 'Đang làm', in_review: 'Đang duyệt', done: 'Hoàn thành', blocked: 'Bị chặn', cancelled: 'Đã hủy', running: 'Đang chạy', succeeded: 'Xong', failed: 'Lỗi' };
  const tone = (s) => `var(--roadmap-tone-${s in P && s !== 'circle' ? s : 'backlog'})`;
  const usd = (v) => (v == null ? '—' : `$${v.toFixed(2).replace('.', ',')}`);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const short = (a) => { const m = /(?:^|[-_\s])((?:assistant|executor|reviewer|integrator)(?:[-_\s]?\d+)?)$/i.exec(a); return m ? m[1] : a; };

  // ── Kích thước thẻ: khớp roadmapNodeSize / ISSUE_HEIGHT / runsHeight của roadmap-layout.ts ──
  const SLOT = 268; // thẻ 240 + khe 28
  const ROW_GAP = 64;
  const runLines = (n) => (n.runs ? Math.min(3, n.runs.runs.length) : 0);
  function size(n) {
    switch (n.kind) {
      case 'request': return { w: 236, h: 82 + (n.detail ? 30 : 0) + (n.runs ? 30 + runLines(n) * 16 : 0) };
      case 'ticket': return { w: 240, h: 82 + (n.detail ? 30 : 0) + (n.runs ? 30 + runLines(n) * 16 : 0) };
      case 'company': return { w: 160, h: 160 };
      case 'project': return { w: 136, h: 136 };
      default: return { w: 200, h: 64 };
    }
  }

  // ── Bố cục: mỗi yêu cầu là một "đảo" cây trên xuống (giống bản đồ trong trang issue); đảo xếp kệ dưới project; project
  //    xếp một hàng dưới công ty. Vị trí ổn định theo thứ tự dữ liệu. ──
  const NODES = new Map(); // id → { n, x, y, w, h, depth, parent, island, cluster }
  const ISLANDS = []; // { id, root, x0, y0, w, h, cluster, nodes: [], edges: [] }
  const CLUSTERS = [];

  function islandOf(rootNode, kids, extraEdges) {
    const leaves = (n) => { const c = kids(n); return c.length ? c.reduce((s, x) => s + leaves(x), 0) : 1; };
    const rows = [];
    const placed = [];
    const walk = (n, left, depth, parent) => {
      const L = leaves(n);
      const s = size(n);
      placed.push({ n, x: left + (L * SLOT - 28) / 2, depth, parent, ...s });
      rows[depth] = Math.max(rows[depth] ?? 0, s.h);
      let x = left;
      for (const c of kids(n)) { walk(c, x, depth + 1, n.id); x += leaves(c) * SLOT; }
    };
    walk(rootNode, 0, 0, null);
    const top = []; let y = 0;
    rows.forEach((h, d) => { top[d] = y; y += h + ROW_GAP; });
    for (const p of placed) p.y = top[p.depth] + p.h / 2;
    const edges = placed.filter((p) => p.parent).map((p) => ({ kind: 'parent', source: p.parent, target: p.n.id }));
    return { root: rootNode, placed, w: leaves(rootNode) * SLOT - 28, h: y - ROW_GAP, edges: edges.concat(extraEdges) };
  }

  const company = DATA.company;
  const CL_GAP = 640, ISL_GX = 150, ISL_GY = 330, PLATE = 300, Y0 = 2300;
  let cx = 0;
  for (const p of DATA.projects) {
    const isl = [];
    if (p.docs) isl.push(islandOf(p.docs, (n) => n.folders ?? n.pages ?? [], []));
    for (const r of p.requests) isl.push(islandOf(r, (n) => n.children ?? [], r.edges));
    const area = isl.reduce((a, i) => a + (i.w + ISL_GX) * (i.h + ISL_GY), 0);
    const maxW = Math.max(2300, ...isl.map((i) => i.w), Math.sqrt(area * 1.5));
    // xếp kệ
    const shelves = []; let cur = { items: [], w: 0, h: 0 };
    for (const i of isl) {
      if (cur.items.length && cur.w + ISL_GX + i.w > maxW) { shelves.push(cur); cur = { items: [], w: 0, h: 0 }; }
      cur.w += (cur.items.length ? ISL_GX : 0) + i.w; cur.h = Math.max(cur.h, i.h); cur.items.push(i);
    }
    shelves.push(cur);
    const cw = Math.max(...shelves.map((s) => s.w));
    let y = Y0 + PLATE;
    for (const s of shelves) {
      let x = cx + (cw - s.w) / 2;
      for (const i of s.items) { i.x0 = x; i.y0 = y; x += i.w + ISL_GX; }
      y += s.h + ISL_GY;
    }
    const cl = { p, x0: cx, y0: Y0 - 260, w: cw, h: y - ISL_GY - (Y0 - 260), islands: isl, ox: cx + cw / 2, oy: Y0 - 130 };
    CLUSTERS.push(cl);
    for (const i of isl) {
      const island = { id: i.root.id, root: i.root, x0: i.x0, y0: i.y0, w: i.w, h: i.h, cluster: cl, nodes: [], edges: i.edges };
      ISLANDS.push(island);
      for (const q of i.placed) {
        const rec = { n: q.n, x: i.x0 + q.x, y: i.y0 + q.y, w: q.w, h: q.h, depth: q.depth, parent: q.parent ?? p.id, island, cluster: cl };
        NODES.set(q.n.id, rec); island.nodes.push(rec);
      }
    }
    NODES.set(p.id, { n: p, x: cl.ox, y: cl.oy, w: 136, h: 136, parent: 'company', cluster: cl });
    cx += cw + CL_GAP;
  }
  const shift = -(cx - CL_GAP) / 2;
  // Bản đồ càng rộng thì toàn cảnh càng thu nhỏ: hạ hàng project xuống thêm để nút công ty không đè nút project.
  const drop = Math.max(0, (cx - CL_GAP) * 0.2 - (Y0 - 62));
  for (const cl of CLUSTERS) { cl.x0 += shift; cl.ox += shift; cl.y0 += drop; cl.oy += drop; }
  for (const i of ISLANDS) { i.x0 += shift; i.y0 += drop; }
  for (const r of NODES.values()) { r.x += shift; r.y += drop; }
  NODES.set('company', { n: company, x: 0, y: 0, w: 160, h: 160, parent: null });
  const WORLD = {
    x0: Math.min(...CLUSTERS.map((c) => c.x0)) - 200, y0: -700,
    x1: Math.max(...CLUSTERS.map((c) => c.x0 + c.w)) + 200, y1: Math.max(...CLUSTERS.map((c) => c.y0 + c.h)) + 200,
  };

  // ── Vẽ thẻ (Face của roadmap-node.tsx) ──
  const head = (n) => `<span class="head">${icon(n.status, 'glyph')}<span class="ident">${n.id}</span><span class="pill roadmap-pill">${STATUS[n.status]}</span></span>`;
  const runsBlock = (n) => {
    if (!n.runs) return '';
    const lines = n.runs.runs.slice(0, 3).map((r) => `<span class="run"><span class="dot ${r.status}"></span><span class="agent">${esc(short(r.agent))}</span><span class="model">${r.model}</span><span class="dur">${r.dur}</span><span class="cost">${usd(r.cost)}</span></span>`).join('');
    const more = n.runs.count - n.runs.runs.length;
    const total = n.runs.tree ? `Cả cây ${usd(n.runs.total)} · ${n.runs.count} run` : `${usd(n.runs.total)} · ${n.runs.count} run`;
    return `<span class="runs">${lines}<span class="run total">${more > 0 ? `<span>+${more} run</span>` : ''}<span class="sum">${total}</span></span></span>`;
  };
  function face(n) {
    switch (n.kind) {
      case 'company':
        return `<span class="inner" style="display:contents">${icon('building', 'glyph-lg')}<strong>${esc(n.title)}</strong><span class="meta" style="height:auto">${n.total} project · ${n.open} yêu cầu mở</span><span class="meta" style="height:auto">${n.tickets} việc · ${n.running} đang chạy</span></span>`;
      case 'project':
        return `${icon('folder', 'glyph-md')}<strong>${esc(n.title)}</strong><span class="meta" style="height:auto">${n.total} yêu cầu · ${n.open} mở</span><span class="meta" style="height:auto">${n.tickets} việc · ${n.running} chạy</span>`;
      case 'request':
        return `${head(n)}<strong class="title">${esc(n.title)}</strong><span class="progress"><span class="bar"><span style="width:${n.total ? Math.round((n.done / n.total) * 100) : 0}%"></span></span><span class="n">${n.done}/${n.total} việc con xong</span></span>${n.detail ? `<span class="console roadmap-console"><i>›</i>${esc(n.detail)}</span>` : ''}${runsBlock(n)}`;
      case 'ticket':
        return `${head(n)}<strong class="title">${esc(n.title)}</strong><span class="meta">${icon('bot')}<span class="trunc"${n.assignee ? '' : ' style="font-style:italic"'}>${esc(n.assignee ? short(n.assignee) : 'Chưa giao')}</span>${n.children.length ? `<span class="right">${icon('branch')}${n.children.length} con</span>` : ''}</span>${n.detail ? `<span class="console roadmap-console"><i>›</i>${esc(n.detail)}</span>` : ''}${runsBlock(n)}`;
      case 'docs':
        return `<span class="head" style="height:auto">${icon('book', 'glyph')}<strong class="title">Docs</strong></span><span class="meta">${n.total} trang</span>`;
      case 'folder':
        return `<span class="head" style="height:auto">${icon('folderOpen', 'glyph')}<strong class="title">${esc(n.title)}</strong></span><span class="meta">${n.total} trang</span>`;
      default:
        return `<span class="head" style="height:auto">${icon('file', 'glyph')}<strong class="title">${esc(n.title)}</strong></span><span class="meta">${esc(n.subtitle)}</span>`;
    }
  }
  const toneOf = (n) => (n.kind === 'request' || n.kind === 'ticket' ? tone(n.status) : n.kind === 'project' ? n.color || 'var(--primary)' : n.kind === 'page' ? 'var(--muted-foreground)' : 'var(--primary)');
  const label = (n) => {
    switch (n.kind) {
      case 'company': return `Công ty ${n.title}: ${n.total} project, ${n.open} yêu cầu đang mở, ${n.tickets} việc`;
      case 'project': return `Project ${n.title}: ${n.total} yêu cầu, ${n.open} đang mở, ${n.tickets} việc`;
      case 'request': return `${n.id}: ${n.title}, ${STATUS[n.status]}, ${n.done}/${n.total} việc con xong`;
      case 'ticket': return `${n.id}: ${n.title}, ${STATUS[n.status]}, ${n.assignee ?? 'Chưa giao'}`;
      case 'docs': return `Docs: ${n.total} trang`;
      case 'folder': return `Thư mục ${n.title}: ${n.total} trang`;
      default: return `Trang ${n.title}`;
    }
  };
  function nodeEl(rec) {
    const n = rec.n;
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.id = n.id;
    b.dataset.kind = n.kind;
    if (n.status) b.dataset.status = n.status;
    b.className = `rm-node ${n.kind === 'company' || n.kind === 'project' ? 'rm-orb roadmap-orb cs' : 'rm-card roadmap-card'} k-${n.kind}`;
    b.style.cssText = `--tone:${toneOf(n)};left:${rec.x - rec.w / 2}px;top:${rec.y - rec.h / 2}px;${n.kind === 'request' || n.kind === 'ticket' ? `height:${rec.h}px;` : ''}`;
    b.setAttribute('aria-label', label(n));
    b.title = n.id && n.kind !== 'project' && n.kind !== 'company' && !n.id.includes(':') ? `${n.id} · ${n.title}` : n.title;
    b.innerHTML = face(n);
    rec.el = b;
    return b;
  }

  // ── Đường nối (edgePath của roadmap-flow.tsx) ──
  const pt = (p) => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`;
  const box = (r) => ({ c: { x: r.x, y: r.y }, w: r.w, h: r.h });
  function verticalCurve(a, b) {
    const from = { x: a.c.x, y: a.c.y + a.h / 2 }; const to = { x: b.c.x, y: b.c.y - b.h / 2 };
    const k = Math.max(24, Math.abs(to.y - from.y) / 2);
    return `M ${pt(from)} C ${pt({ x: from.x, y: from.y + k })} ${pt({ x: to.x, y: to.y - k })} ${pt(to)}`;
  }
  function underCurve(a, b, depth) {
    const dir = Math.sign(b.c.x - a.c.x) || 1;
    const from = { x: a.c.x + (dir * a.w) / 4, y: a.c.y + a.h / 2 }; const to = { x: b.c.x - (dir * b.w) / 4, y: b.c.y + b.h / 2 };
    const y = Math.max(from.y, to.y) + depth;
    return `M ${pt(from)} C ${pt({ x: from.x, y })} ${pt({ x: to.x, y })} ${pt({ x: to.x, y: to.y + 6 })}`;
  }
  function clip(c, w, h, t) {
    const dx = t.x - c.x, dy = t.y - c.y; if (!dx && !dy) return c;
    const s = Math.min(dx ? w / 2 / Math.abs(dx) : Infinity, dy ? h / 2 / Math.abs(dy) : Infinity);
    return s >= 1 ? c : { x: c.x + dx * s, y: c.y + dy * s };
  }
  function curve(a, b, side) {
    const from = clip(a.c, a.w + 8, a.h + 8, b.c); const to = clip(b.c, b.w + 8, b.h + 8, a.c);
    const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2; const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const bend = side * Math.min(60, len * 0.15);
    return `M ${from.x},${from.y} Q ${mx - ((to.y - from.y) / len) * bend},${my + ((to.x - from.x) / len) * bend} ${to.x},${to.y}`;
  }
  function edgePath(kind, a, b) {
    if (kind === 'parent') return verticalCurve(a, b);
    if (Math.abs(a.c.y - b.c.y) < (a.h + b.h) / 4) return underCurve(a, b, kind === 'blocks' ? 44 : 68);
    return curve(a, b, kind === 'blocks' ? 1 : -1);
  }
  const isRunning = (e) => {
    const s = NODES.get(e.source)?.n.status, t = NODES.get(e.target)?.n.status;
    return e.kind === 'parent' ? t === 'in_progress' : s === 'in_progress' || t === 'in_progress';
  };

  // ── Dựng DOM ──
  const $ = (s) => document.querySelector(s);
  const canvas = $('#canvas');
  const world = $('#world');
  const dots = $('#dots');
  const overlay = $('#overlay');
  const SVGNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'edges'); svg.setAttribute('width', '1'); svg.setAttribute('height', '1'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<defs>${['blocks', 'repair'].map((k) => `<marker id="arrow-${k}" viewBox="-10 -10 20 20" markerWidth="16" markerHeight="16" markerUnits="userSpaceOnUse" orient="auto-start-reverse" refX="0" refY="0"><polyline points="-5,-4 0,0 -5,4 -5,-4" fill="var(--roadmap-edge-${k})" stroke="var(--roadmap-edge-${k})" stroke-width="1" stroke-linejoin="round"/></marker>`).join('')}</defs>`;
  world.appendChild(svg);
  const gTrunk = document.createElementNS(SVGNS, 'g');
  svg.appendChild(gTrunk);
  const path = (g, d, attrs) => { const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', d); for (const k in attrs) p.setAttribute(k, attrs[k]); g.appendChild(p); return p; };

  const comp = NODES.get('company');
  const clusterEls = new Map();
  for (const cl of CLUSTERS) {
    const div = document.createElement('div'); div.className = 'cluster'; div.dataset.id = cl.p.id;
    world.appendChild(div); clusterEls.set(cl.p.id, div);
    const orb = NODES.get(cl.p.id);
    overlay.appendChild(nodeEl(orb));
    path(gTrunk, verticalCurve(box(comp), box(orb)), { class: 'roadmap-edge trunk', 'data-edge-kind': 'parent', 'data-cluster': cl.p.id });
  }
  overlay.appendChild(nodeEl(comp));
  for (const isl of ISLANDS) {
    const div = document.createElement('div'); div.className = 'island'; div.dataset.id = isl.id;
    clusterEls.get(isl.cluster.p.id).appendChild(div);
    isl.el = div;
    for (const rec of isl.nodes) div.appendChild(nodeEl(rec));
    // nhãn nổi của đảo (mức 1)
    const r = isl.root;
    const plate = document.createElement('button');
    plate.type = 'button'; plate.className = 'plate'; plate.dataset.plate = r.id; plate.tabIndex = -1;
    plate.style.cssText = `--tone:${toneOf(r)}`;
    plate.innerHTML = r.kind === 'docs'
      ? `<span class="t">${icon('book', 'glyph')} Docs · ${r.total} trang</span>`
      : `<span class="t">${r.id} · ${esc(r.title)}</span><span class="s">${icon(r.status, 'glyph')}${STATUS[r.status]} · ${r.done}/${r.total} việc${(() => { const n = isl.nodes.filter((x) => x.n.status === 'in_progress' && x.n.kind === 'ticket').length; return n ? ` · ${n} đang chạy` : ''; })()}</span>`;
    plate.setAttribute('aria-hidden', 'true');
    overlay.appendChild(plate); isl.plate = plate;
    const g = document.createElementNS(SVGNS, 'g'); g.dataset.island = isl.id; svg.appendChild(g); isl.g = g;
    const orb = NODES.get(isl.cluster.p.id);
    path(gTrunk, verticalCurve(box(orb), box(NODES.get(r.id))), { class: 'roadmap-edge trunk', 'data-edge-kind': 'parent', 'data-island': isl.id });
    isl.paths = [];
    for (const e of isl.edges) {
      const a = NODES.get(e.source), b = NODES.get(e.target);
      if (!a || !b) continue;
      const d = edgePath(e.kind, box(a), box(b));
      const run = isRunning(e);
      const attrs = { class: 'roadmap-edge inner', 'data-edge-kind': e.kind };
      if (run) attrs['data-running'] = '';
      if (e.kind !== 'parent') attrs['marker-end'] = `url(#arrow-${e.kind})`;
      path(g, d, attrs);
      if (run) isl.paths.push(d);
    }
  }

  // ── Camera ──
  const PAD = { top: 52, right: 64, bottom: 24, left: 24 };
  let cam = { cx: 0, cy: 0, k: 0.1 };
  let lod = -1;
  const W = () => canvas.clientWidth, H = () => canvas.clientHeight;
  const narrow = () => W() < 640;
  function lodFor(k) {
    // ngưỡng có trễ ±0.02 để không nhấp nháy khi dừng ngay mốc
    const up = [0.16, 0.55];
    if (lod === 0) return k >= up[0] + 0.02 ? (k >= up[1] ? 2 : 1) : 0;
    if (lod === 2) return k < up[1] - 0.02 ? (k < up[0] ? 0 : 1) : 2;
    return k < up[0] - 0.02 ? 0 : k >= up[1] + 0.02 ? 2 : 1;
  }
  const LOD_NAME = ['Ô màu', 'Nhãn yêu cầu', 'Thẻ đầy đủ'];
  function apply() {
    const tx = W() / 2 - cam.cx * cam.k, ty = H() / 2 - cam.cy * cam.k;
    world.style.transform = `translate(${tx}px, ${ty}px) scale(${cam.k})`;
    const g = 22 * cam.k;
    dots.style.backgroundSize = `${g}px ${g}px`;
    dots.style.backgroundPosition = `${tx}px ${ty}px`;
    const l = lodFor(cam.k);
    if (l !== lod) { lod = l; canvas.dataset.lod = String(l); }
    // Lớp phủ cỡ cố định trên màn hình: nút tròn (công ty, project) không nhỏ hơn mức đọc được, nhãn đảo ở mức 1.
    const at = (x, y) => [tx + x * cam.k, ty + y * cam.k];
    for (const rec of [comp, ...CLUSTERS.map((c) => NODES.get(c.p.id))]) {
      // Nút project lớn lên phía trên (neo đáy nút) để không che hàng đảo đầu tiên của cụm.
      const proj = rec.n.kind === 'project';
      const [sx, sy] = at(rec.x, proj ? rec.y + rec.h / 2 : rec.y);
      const s = Math.max(cam.k, narrow() ? 0.5 : 0.9);
      rec.el.style.left = `${sx}px`; rec.el.style.top = `${sy}px`;
      rec.el.style.transformOrigin = proj ? '50% 100%' : '50% 50%';
      rec.el.style.transform = proj ? `translate(-50%, -100%) scale(${s})` : `translate(-50%, -50%) scale(${s})`;
    }
    if (lod === 1) {
      for (const isl of ISLANDS) {
        const [sx, sy] = at(isl.x0, isl.y0);
        isl.plate.style.left = `${sx}px`; isl.plate.style.top = `${sy}px`;
        isl.plate.style.width = `${Math.max(150, Math.min(300, isl.w * cam.k))}px`;
      }
    }
    zoomChip.textContent = `${Math.round(cam.k * 100)}% · ${LOD_NAME[lod]}`;
    drawMini();
  }
  const ease = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)); // ease-out-expo (--motion-ease-out-expo)
  let anim = 0;
  function flyTo(t, { instant = false } = {}) {
    cancelAnimationFrame(anim);
    const from = { ...cam };
    const dur = instant || reduced ? 0 : t.k >= from.k ? 450 : 650; // --roadmap-zoom-in / --roadmap-zoom-out
    if (!dur) { cam = { ...t }; apply(); settle(); return; }
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = ease(p);
      cam = { cx: from.cx + (t.cx - from.cx) * e, cy: from.cy + (t.cy - from.cy) * e, k: Math.exp(Math.log(from.k) + (Math.log(t.k) - Math.log(from.k)) * e) };
      apply();
      if (p < 1) anim = requestAnimationFrame(step); else settle();
    };
    anim = requestAnimationFrame(step);
  }
  function fit(b, minK, maxK, topAlign) {
    const aw = W() - PAD.left - PAD.right, ah = H() - PAD.top - PAD.bottom;
    let k = Math.min(aw / b.w, ah / b.h);
    const fits = k >= minK;
    k = Math.max(minK, Math.min(maxK, k));
    const cx = b.x + b.w / 2 + (PAD.right - PAD.left) / 2 / k;
    let cy = b.y + b.h / 2 - (PAD.top - PAD.bottom) / 2 / k;
    if (!fits && topAlign) cy = b.y + (H() / 2 - PAD.top) / k;
    return { cx, cy, k };
  }

  // Dây "đang chạy": chỉ vẽ lớp chạy cho đảo đang trong khung ở mức 2, tối đa MAX_FLOW_EDGES dây (giới hạn hiệu năng).
  const MAX_FLOW_EDGES = 30;
  function settle() {
    for (const isl of ISLANDS) isl.g.querySelectorAll('[data-edge-flow]').forEach((p) => p.remove());
    if (lod !== 2 || reduced) return;
    const vw = W() / cam.k, vh = H() / cam.k;
    const v = { x0: cam.cx - vw / 2, y0: cam.cy - vh / 2, x1: cam.cx + vw / 2, y1: cam.cy + vh / 2 };
    let n = 0;
    for (const isl of ISLANDS) {
      if (isl.x0 > v.x1 || isl.x0 + isl.w < v.x0 || isl.y0 > v.y1 || isl.y0 + isl.h < v.y0) continue;
      for (const d of isl.paths) {
        if (n++ >= MAX_FLOW_EDGES) return;
        path(isl.g, d, { class: 'roadmap-edge-flow', 'data-edge-flow': '' });
        path(isl.g, d, { class: 'roadmap-edge-spark', 'data-edge-flow': '', pathLength: '100' });
      }
    }
  }

  // ── Lấy nét (focus) ──
  let focus = { kind: 'overview', id: null };
  function target(f) {
    if (f.kind === 'overview') {
      const t = fit({ x: WORLD.x0, y: WORLD.y0 + 300, w: WORLD.x1 - WORLD.x0, h: WORLD.y1 - WORLD.y0 - 300 }, 0.01, 1);
      // Màn hẹp: không ép cả công ty vào 360px (nút tròn sẽ chồng nhau); giữ độ phóng tối thiểu, canh nút công ty ở
      // giữa, vuốt ngang để xem các project khác, bản đồ thu nhỏ luôn hiện.
      if (narrow() && t.k < 0.04) return { cx: 0, cy: t.cy, k: 0.04 };
      return t;
    }
    if (f.kind === 'project') { const cl = CLUSTERS.find((c) => c.p.id === f.id); return fit({ x: cl.x0, y: cl.y0, w: cl.w, h: cl.h }, 0.22, 0.5, true); }
    if (f.kind === 'request' || f.kind === 'docs') { const i = ISLANDS.find((x) => x.id === f.id); return fit({ x: i.x0, y: i.y0, w: i.w, h: i.h }, 0.6, 1.1, true); }
    const r = NODES.get(f.id); return { cx: r.x, cy: r.y + 40, k: 1.05 };
  }
  const parse = () => {
    const m = /^#([prtd])=(.+)$/.exec(decodeURIComponent(location.hash));
    if (!m) return { kind: 'overview', id: null };
    const kind = { p: 'project', r: 'request', t: 'ticket', d: 'docs' }[m[1]];
    return NODES.has(m[2]) || CLUSTERS.some((c) => c.p.id === m[2]) ? { kind, id: m[2] } : { kind: 'overview', id: null };
  };
  const hashOf = (f) => (f.kind === 'overview' ? '#' : `#${f.kind[0]}=${encodeURIComponent(f.id)}`);
  function go(f) {
    if (hashOf(f) === (location.hash || '#')) { flyTo(target(f)); return; }
    location.hash = hashOf(f); // đẩy một mục lịch sử: Back trình duyệt quay về chỗ trước
  }
  function parentOf(f) {
    if (f.kind === 'ticket') { const r = NODES.get(f.id); return { kind: r.island.root.kind === 'docs' ? 'docs' : 'request', id: r.island.id }; }
    if (f.kind === 'request' || f.kind === 'docs') return { kind: 'project', id: ISLANDS.find((i) => i.id === f.id).cluster.p.id };
    return { kind: 'overview', id: null };
  }
  function onFocus(f, instant) {
    focus = f;
    document.querySelectorAll('[data-current]').forEach((e) => e.removeAttribute('data-current'));
    const isl = f.kind === 'ticket' ? NODES.get(f.id).island : ISLANDS.find((i) => i.id === f.id);
    const cl = f.kind === 'project' ? CLUSTERS.find((c) => c.p.id === f.id) : isl?.cluster;
    for (const c of CLUSTERS) {
      const el = clusterEls.get(c.p.id);
      el.classList.toggle('dim-soft', f.kind !== 'overview' && c !== cl);
      NODES.get(c.p.id).el.classList.toggle('dim-soft', f.kind !== 'overview' && c !== cl);
    }
    for (const i of ISLANDS) {
      const dim = (f.kind === 'request' || f.kind === 'ticket' || f.kind === 'docs') && i !== isl && i.cluster === cl;
      i.el.classList.toggle('dim', dim); i.plate.classList.toggle('dim', dim || (f.kind !== 'overview' && i.cluster !== cl)); i.g.classList.toggle('dim', dim || (f.kind !== 'overview' && i.cluster !== cl));
    }
    gTrunk.querySelectorAll('path').forEach((p) => p.classList.toggle('dim', f.kind !== 'overview' && p.dataset.cluster !== cl?.p.id && !(p.dataset.island && ISLANDS.find((i) => i.id === p.dataset.island)?.cluster === cl)));
    if (f.kind === 'request' || f.kind === 'ticket' || f.kind === 'docs') NODES.get(f.id).el.setAttribute('data-current', '');
    // Dây project → yêu cầu của đảo khác bị ẩn ở mức thẻ đầy đủ (không cắt ngang thẻ đang đọc), dây của đảo đang xem giữ lại.
    gTrunk.querySelectorAll('[data-island]').forEach((p) => p.classList.toggle('keep', p.dataset.island === isl?.id));
    ui(f);
    flyTo(target(f), { instant });
  }

  // ── Đầu trang, gợi ý, thẻ "đang xem", thông báo đọc màn hình ──
  const zoomChip = $('#zoom-chip');
  const crumbsEl = $('#crumbs');
  function chain(f) {
    const out = [];
    let c = f;
    while (c.kind !== 'overview') { out.unshift(c); c = parentOf(c); }
    return out;
  }
  const nameOf = (f) => {
    if (f.kind === 'project') return CLUSTERS.find((c) => c.p.id === f.id).p.title;
    const n = NODES.get(f.id).n;
    return n.kind === 'docs' ? 'Docs' : n.kind === 'request' ? `${n.id} ${n.title}` : n.id.includes(':') ? n.title : n.id;
  };
  const HINT = {
    overview: 'Bấm project, yêu cầu hay việc để phóng tới · kéo để di chuyển · cuộn để phóng to',
    project: 'Bấm một yêu cầu để phóng tới · Esc: ra toàn cảnh',
    request: 'Bấm việc con để phóng tới · bấm lại yêu cầu để mở chi tiết · Esc: ra project',
    ticket: 'Bấm lại hoặc Enter để mở chi tiết · Esc: ra yêu cầu',
    docs: 'Bấm trang để đọc · Esc: ra project',
  };
  function ui(f) {
    const parts = [`<a href="#" data-go="overview">${esc(company.title)}</a>`];
    const ch = chain(f);
    ch.forEach((c, i) => {
      parts.push('<span class="sep" aria-hidden="true">›</span>');
      parts.push(i === ch.length - 1 ? `<span aria-current="page">${esc(nameOf(c))}</span>` : `<a href="${hashOf(c)}">${esc(nameOf(c))}</a>`);
    });
    if (!ch.length) parts[0] = `<span aria-current="page">${esc(company.title)}</span>`;
    crumbsEl.innerHTML = parts.join('');
    $('#btn-up').disabled = f.kind === 'overview';
    $('#btn-all').disabled = f.kind === 'overview';
    $('#hint').textContent = HINT[f.kind];
    const fc = $('#focus-card');
    if (f.kind === 'request' || f.kind === 'ticket') {
      const n = NODES.get(f.id).n;
      fc.hidden = false;
      fc.style.setProperty('--tone', tone(n.status));
      fc.innerHTML = `${icon(n.status, 'glyph')}<span class="ident">${n.id}</span><strong class="title">${esc(n.title)}</strong><button type="button" class="btn" id="btn-open">${icon('open')}Mở chi tiết <kbd class="label-wide">Enter</kbd></button>`;
      $('#btn-open').onclick = () => openDetail(n);
    } else fc.hidden = true;
    $('#minimap').hidden = f.kind === 'overview' && !narrow();
    const n = f.id && NODES.get(f.id)?.n;
    $('#live').textContent = f.kind === 'overview' ? `Toàn cảnh công ty ${company.title}` : `Đang xem ${n ? label(n) : nameOf(f)}`;
  }
  let toastTimer = 0;
  function toast(html) {
    const t = $('#toast'); t.innerHTML = html; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  const openDetail = (n) => toast(`Mở popup chi tiết <b>${n.id}</b> trên bản đồ (<code>?issue=${n.id}</code>), camera giữ nguyên.`);

  // ── Bấm, kéo, cuộn, phím ──
  let drag = null, moved = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.controls, .focus-card, .minimap')) return;
    drag = { x: e.clientX, y: e.clientY, cx: cam.cx, cy: cam.cy }; moved = false;
  });
  addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    if (!moved) canvas.setPointerCapture?.(e.pointerId);
    moved = true; canvas.classList.add('dragging');
    cancelAnimationFrame(anim);
    cam.cx = drag.cx - dx / cam.k; cam.cy = drag.cy - dy / cam.k; apply();
  });
  addEventListener('pointerup', () => { if (drag && moved) settle(); drag = null; canvas.classList.remove('dragging'); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault(); cancelAnimationFrame(anim);
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left - W() / 2, my = e.clientY - r.top - H() / 2;
    const wx = cam.cx + mx / cam.k, wy = cam.cy + my / cam.k;
    const k = Math.max(0.01, Math.min(3, cam.k * Math.exp(-e.deltaY * 0.0015)));
    cam = { cx: wx - mx / k, cy: wy - my / k, k }; apply();
    clearTimeout(canvas._t); canvas._t = setTimeout(settle, 150);
  }, { passive: false });
  canvas.addEventListener('click', (e) => {
    if (moved) return;
    const plate = e.target.closest('[data-plate]');
    if (plate) { const i = ISLANDS.find((x) => x.id === plate.dataset.plate); go({ kind: i.root.kind === 'docs' ? 'docs' : 'request', id: i.id }); return; }
    const b = e.target.closest('.rm-node'); if (!b) return;
    const rec = NODES.get(b.dataset.id); const n = rec.n;
    switch (n.kind) {
      case 'company': go({ kind: 'overview', id: null }); return;
      case 'project': go({ kind: 'project', id: n.id }); return;
      case 'request': if (focus.id === n.id) openDetail(n); else go({ kind: 'request', id: n.id }); return;
      case 'ticket': if (focus.id === n.id) openDetail(n); else go({ kind: 'ticket', id: n.id }); return;
      case 'docs': go({ kind: 'docs', id: n.id }); return;
      case 'folder': go({ kind: focus.id === n.id ? 'docs' : 'ticket', id: focus.id === n.id ? rec.island.id : n.id }); return;
      default: if (lod === 2) toast(`Mở popup đọc docs <code>?doc=${esc(n.subtitle)}</code> trên bản đồ.`); else go({ kind: 'ticket', id: n.id });
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('#toast').classList.contains('show')) { $('#toast').classList.remove('show'); return; }
      if (focus.kind !== 'overview') go(parentOf(focus));
    } else if (e.key === '0' && !e.metaKey) go({ kind: 'overview', id: null });
    else if (e.key === '+' || e.key === '=') zoomBy(1.4);
    else if (e.key === '-') zoomBy(1 / 1.4);
    else if (e.key === 'Enter' && (focus.kind === 'request' || focus.kind === 'ticket') && !e.target.closest?.('button')) openDetail(NODES.get(focus.id).n);
  });
  const zoomBy = (f) => flyTo({ ...cam, k: Math.max(0.01, Math.min(3, cam.k * f)) });
  $('#zoom-in').onclick = () => zoomBy(1.4);
  $('#zoom-out').onclick = () => zoomBy(1 / 1.4);
  $('#zoom-fit').onclick = () => go({ kind: 'overview', id: null });
  $('#btn-up').onclick = () => go(parentOf(focus));
  $('#btn-all').onclick = () => go({ kind: 'overview', id: null });
  crumbsEl.addEventListener('click', (e) => { const a = e.target.closest('[data-go="overview"]'); if (a) { e.preventDefault(); go({ kind: 'overview', id: null }); } });
  addEventListener('hashchange', () => onFocus(parse()));
  addEventListener('resize', () => flyTo(target(focus), { instant: true }));

  // ── Bản đồ thu nhỏ ──
  const mini = $('#minimap');
  const miniSvg = mini.querySelector('svg');
  miniSvg.setAttribute('viewBox', `${WORLD.x0} ${WORLD.y0} ${WORLD.x1 - WORLD.x0} ${WORLD.y1 - WORLD.y0}`);
  miniSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  miniSvg.innerHTML = ISLANDS.map((i) => `<rect x="${i.x0}" y="${i.y0}" width="${i.w}" height="${i.h}" rx="40" fill="${i.root.kind === 'docs' ? 'var(--muted-foreground)' : tone(i.root.status)}" opacity=".55"/>`).join('') +
    CLUSTERS.map((c) => `<circle cx="${c.ox}" cy="${c.oy}" r="160" fill="${c.p.color || 'var(--primary)'}"/>`).join('') + '<rect class="vp" rx="20"/>';
  const vp = miniSvg.querySelector('.vp');
  function drawMini() {
    const vw = W() / cam.k, vh = H() / cam.k;
    vp.setAttribute('x', cam.cx - vw / 2); vp.setAttribute('y', cam.cy - vh / 2); vp.setAttribute('width', vw); vp.setAttribute('height', vh);
  }
  mini.addEventListener('click', (e) => {
    const r = miniSvg.getBoundingClientRect();
    const s = Math.min(r.width / (WORLD.x1 - WORLD.x0), r.height / (WORLD.y1 - WORLD.y0));
    const ox = (r.width - (WORLD.x1 - WORLD.x0) * s) / 2, oy = (r.height - (WORLD.y1 - WORLD.y0) * s) / 2;
    flyTo({ ...cam, cx: WORLD.x0 + (e.clientX - r.left - ox) / s, cy: WORLD.y0 + (e.clientY - r.top - oy) / s });
  });

  // ── Khởi động: luôn mở ở toàn cảnh; deep link (#r=…) thì bay vào từ toàn cảnh ──
  if (STATE || VIEW === 'list') return;
  cam = target({ kind: 'overview' }); apply();
  ui(focus);
  const first = parse();
  if (first.kind !== 'overview') setTimeout(() => onFocus(first), 250);
  else settle();
  window.ROADMAP = { NODES, ISLANDS, CLUSTERS, go };
})();
