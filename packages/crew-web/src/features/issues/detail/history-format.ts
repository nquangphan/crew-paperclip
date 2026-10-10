// Dựng các dòng của khối Lịch sử từ GET /issues/:id/activity (mới nhất trước). Lần Ép Done ghi hai bản ghi: H2 ghi
// `crew.policy.board_override` (actor là owner, có danh sách cổng bỏ qua) trong transaction cập nhật, rồi plugin ghi
// `crew.issue.force_done` (actor là plugin, có lý do và `actorUserId`; `violations` của nó thường rỗng vì plugin không
// đọc được activity). Hai bản ghi cách nhau ≤ 5 giây và cùng owner thì gộp thành một dòng. Cùng lần ép, host còn ghi thay
// plugin `issue.updated` (trạng thái trong `details.patch`) và `issue.comment.created` (bình luận lý do): hai bản ghi
// này cũng gộp vào dòng Ép Done. Bản ghi plugin khác hiện người đứng sau (`initiatingActor*`) nếu host có ghi.
import type { ActivityEvent } from '@paperclipai/shared';
import type { TFunction } from 'i18next';
import { formatDateTime, type Lang } from '@/i18n';

export const FORCE_DONE_ACTION = 'crew.issue.force_done';
export const BOARD_OVERRIDE_ACTION = 'crew.policy.board_override';
const CYCLE_RESET_ACTION = 'crew.gate.cycle_reset';
const MERGE_WINDOW_MS = 5_000;
const CLOSED = new Set(['done', 'cancelled']);

/** Bản ghi riêng của từng người (đã đọc, lưu hộp thư): không phải lịch sử của yêu cầu. */
const HIDDEN = new Set(['issue.read_marked', 'issue.read_unmarked', 'issue.inbox_archived', 'issue.inbox_unarchived']);

/** Action → khóa `history.action.*`. `issue.updated` đổi trạng thái có câu riêng. */
const ACTION_KEY: Record<string, string> = {
  'issue.created': 'created',
  'issue.updated': 'updated',
  'issue.comment_added': 'commentAdded',
  'issue.comment.created': 'commentAdded',
  'issue.child_created': 'childCreated',
  'issue.attachment_added': 'attachmentAdded',
  'issue.attachment_removed': 'attachmentRemoved',
  'issue.document_created': 'documentChanged',
  'issue.document_updated': 'documentChanged',
  'issue.document_deleted': 'documentDeleted',
  'issue.thread_interaction_created': 'interactionCreated',
  'issue.thread_interaction_answered': 'interactionAnswered',
  'issue.thread_interaction_accepted': 'interactionAnswered',
  'issue.thread_interaction_rejected': 'interactionAnswered',
  [CYCLE_RESET_ACTION]: 'cycleReset',
  'crew.docs_gate.uninitialized': 'docsUninitialized',
  [BOARD_OVERRIDE_ACTION]: 'boardOverride',
  [FORCE_DONE_ACTION]: 'forceDone',
};

/** Mã vi phạm có câu dịch (`history.violation.*`); mã dạng `tên:tham_số` tách phần sau dấu `:`. */
const VIOLATIONS = new Set([
  'stage_unapproved',
  'docs_missing',
  'docs_stale',
  'docs_failed',
  'push_missing',
  'push_stale',
  'push_sha_mismatch',
  'policy_missing',
  'roles_unconfigured',
]);

export interface HistoryCtx {
  t: TFunction;
  lang: Lang;
  /** Tên hiển thị của stage theo policy; null thì dùng mã stage. */
  stageName: (stageId: string) => string | null;
}

export interface HistoryEntry {
  id: string;
  time: string;
  actor: { type: ActivityEvent['actorType']; id: string };
  /** Lần đóng vượt cổng (Ép Done hoặc board đóng thẳng). */
  forced: boolean;
  text: string;
  reason: string | null;
  /** Cổng bị bỏ qua, đã dịch. */
  skipped: string[];
}

type Details = Record<string, unknown>;

const detailsOf = (e: ActivityEvent): Details => e.details ?? {};
const timeOf = (e: ActivityEvent) => new Date(e.createdAt).getTime();
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const prevStatus = (d: Details) => str((d._previous as Details | undefined)?.status);
/** Trạng thái mới: route stock ghi `details.status`, plugin (qua host) ghi `details.patch.status`. */
const nextStatus = (d: Details) => str(d.status) ?? str((d.patch as Details | undefined)?.status);

export function describeViolation(code: string, ctx: HistoryCtx): string {
  const at = code.indexOf(':');
  const name = at < 0 ? code : code.slice(0, at);
  const arg = at < 0 ? '' : code.slice(at + 1);
  if (!VIOLATIONS.has(name)) return code;
  if (name === 'stage_unapproved') {
    return ctx.t('history.violation.stage_unapproved', { stage: ctx.stageName(arg) ?? arg });
  }
  return ctx.t(`history.violation.${name}`, { code: arg });
}

/** Owner đứng sau lần Ép Done: plugin ghi `details.actorUserId` (host có thể thêm `initiatingUserId`). */
function forceDoneUser(e: ActivityEvent): string | null {
  if (e.actorType === 'user') return e.actorId;
  const d = detailsOf(e);
  return str(d.actorUserId) ?? str(d.initiatingUserId);
}

/** Người đứng sau bản ghi plugin ghi (host thêm `initiatingActor*`); null nếu không biết. */
function initiatorOf(e: ActivityEvent): HistoryEntry['actor'] | null {
  if (e.actorType !== 'plugin') return null;
  const d = detailsOf(e);
  const type = str(d.initiatingActorType);
  const id = str(d.initiatingActorId);
  if ((type === 'user' || type === 'agent') && id) return { type, id };
  const user = str(d.initiatingUserId);
  if (user) return { type: 'user', id: user };
  const agent = str(d.initiatingAgentId);
  return agent ? { type: 'agent', id: agent } : null;
}

/** Bản ghi đổi trạng thái sang done và bình luận lý do mà host ghi thay plugin trong cùng lần ép. */
function isForceDoneSideEffect(e: ActivityEvent, force: ActivityEvent): boolean {
  if (force.actorType !== 'plugin' || e.actorType !== 'plugin' || e.actorId !== force.actorId) return false;
  if (Math.abs(timeOf(e) - timeOf(force)) > MERGE_WINDOW_MS) return false;
  const user = forceDoneUser(force);
  const by = initiatorOf(e);
  if (user !== null && !(by?.type === 'user' && by.id === user)) return false;
  if (e.action === 'issue.comment.created') return true;
  return e.action === 'issue.updated' && nextStatus(detailsOf(e)) === 'done';
}

/** Bản ghi board_override đi cùng `force` (≤ 5 giây, cùng user nếu biết user). */
function partnerOf(force: ActivityEvent, events: ActivityEvent[], used: Set<string>): ActivityEvent | null {
  const user = forceDoneUser(force);
  return (
    events.find(
      (e) =>
        e.action === BOARD_OVERRIDE_ACTION &&
        !used.has(e.id) &&
        Math.abs(timeOf(e) - timeOf(force)) <= MERGE_WINDOW_MS &&
        (user === null || (e.actorType === 'user' && e.actorId === user)),
    ) ?? null
  );
}

/** Người làm: lần Ép Done do plugin ghi thì hiện owner đứng sau (bản ghi H2 đi cùng, hoặc `initiatingUserId`). */
function actorOf(e: ActivityEvent, partner: ActivityEvent | null): HistoryEntry['actor'] {
  if (e.action !== FORCE_DONE_ACTION || e.actorType === 'user') {
    return initiatorOf(e) ?? { type: e.actorType, id: e.actorId };
  }
  if (partner) return { type: partner.actorType, id: partner.actorId };
  const user = forceDoneUser(e);
  return user ? { type: 'user', id: user } : { type: e.actorType, id: e.actorId };
}

function actionText(e: ActivityEvent, ctx: HistoryCtx): string {
  const d = detailsOf(e);
  if (e.action === 'issue.updated') {
    const to = nextStatus(d);
    const from = prevStatus(d);
    if (to && from && to !== from) {
      const label = (s: string) => ctx.t(`status.${s}`, { ns: 'common', defaultValue: s });
      return ctx.t('history.action.statusChanged', { from: label(from), to: label(to) });
    }
  }
  const key = ACTION_KEY[e.action];
  return key ? ctx.t(`history.action.${key}`) : e.action;
}

export function buildHistory(events: ActivityEvent[], ctx: HistoryCtx): HistoryEntry[] {
  const visible = events.filter((e) => !HIDDEN.has(e.action));
  const merged = new Map<string, ActivityEvent>();
  const used = new Set<string>();
  for (const e of visible) {
    if (e.action !== FORCE_DONE_ACTION) continue;
    const partner = partnerOf(e, visible, used);
    if (partner) {
      used.add(partner.id);
      merged.set(e.id, partner);
    }
    for (const other of visible) {
      if (!used.has(other.id) && isForceDoneSideEffect(other, e)) used.add(other.id);
    }
  }
  return visible
    .filter((e) => !used.has(e.id))
    .map((e) => {
      const d = detailsOf(e);
      const partner = merged.get(e.id) ?? null;
      const forced = e.action === FORCE_DONE_ACTION || e.action === BOARD_OVERRIDE_ACTION;
      const own = strings(d.violations);
      const violations = own.length > 0 ? own : partner ? strings(detailsOf(partner).violations) : [];
      return {
        id: e.id,
        time: formatDateTime(e.createdAt, ctx.lang),
        actor: actorOf(e, partner),
        forced,
        text: actionText(e, ctx),
        reason: forced ? str(d.reason) : null,
        skipped: forced ? violations.map((v) => describeViolation(v, ctx)) : [],
      };
    });
}

/** Bản ghi mở lại yêu cầu đã đóng (H2 xóa state, hoặc PATCH đổi từ done/cancelled sang trạng thái mở). */
function isReopen(e: ActivityEvent): boolean {
  const d = detailsOf(e);
  if (e.action === CYCLE_RESET_ACTION) return !CLOSED.has(str(d.toStatus) ?? '');
  if (e.action !== 'issue.updated') return false;
  if (d.reopened === true) return true;
  const from = prevStatus(d);
  const to = nextStatus(d);
  return !!from && !!to && CLOSED.has(from) && !CLOSED.has(to);
}

/** Badge "Đã ép Done": yêu cầu đang done và lần Ép Done mới nhất sau lần mở lại gần nhất. */
export function forcedDoneActive(events: ActivityEvent[], status: string): boolean {
  if (status !== 'done') return false;
  const latest = (pick: (e: ActivityEvent) => boolean) =>
    events.filter(pick).reduce((max, e) => Math.max(max, timeOf(e)), Number.NEGATIVE_INFINITY);
  const forced = latest((e) => e.action === FORCE_DONE_ACTION);
  return forced > Number.NEGATIVE_INFINITY && forced > latest(isReopen);
}
