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

/** Mỗi số ghi rõ đo kiểu nào; số chưa đo không bao giờ thành 0. */
export function formatMeasured(value: Measured): string {
  return value.kind === "chua_do" ? "Chưa đo" : `${formatBytes(value.bytes)} (${KIND_LABEL[value.kind]})`;
}
