import type { AttachmentCache } from "../../machines/webhook.js";
import type { Measured } from "../../storage/data.js";

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const one = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) { value /= 1024; unit += 1; }
  return `${unit === 0 ? Math.round(value) : one.format(value)} ${UNITS[unit]}`;
}

const KIND_LABEL = { logic: "logic", vat_ly: "vật lý" } as const;

/**
 * Mỗi số ghi rõ đo kiểu nào; số chưa đo không bao giờ thành 0. `lowerBound` khi tổng bỏ sót mục chưa có cỡ.
 */
export function formatMeasured(value: Measured, opts: { lowerBound?: boolean } = {}): string {
  if (value.kind === "chua_do") return "Chưa đo";
  return opts.lowerBound
    ? `≥ ${formatBytes(value.bytes)} (${KIND_LABEL[value.kind]}, cận dưới)`
    : `${formatBytes(value.bytes)} (${KIND_LABEL[value.kind]})`;
}

/** `blobBytes` là phần GC so với trần; `bytes` là toàn bộ cache (gồm derived, runs, incoming). */
export function formatCacheUsage(cache: Pick<AttachmentCache, "bytes" | "blobBytes" | "limitBytes">): string {
  return `blob ${formatBytes(cache.blobBytes)} / trần ${formatBytes(cache.limitBytes)} · tổng cache ${formatBytes(cache.bytes)}`;
}
