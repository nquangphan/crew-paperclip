/**
 * Attachment type rules shared with `crew-mac files` (apps/crew-mac/src/files/policy.ts in the Crew repo).
 * Both copies hold the same three lists and are pinned by an identical string test on each side.
 *
 * The plugin only warns the owner; the Mac side decides what an agent may read. So the plugin concludes
 * from the extension (same extension-to-label table as the Mac), the declared content type only when the
 * extension is not allowed, and, for the signature-checked group, an executable signature in the first bytes. Every other mismatch between
 * name and bytes is left to the Mac, which detects the real format.
 */

export const ALLOWED_EXTENSIONS: readonly string[] = (
  "png jpg jpeg gif webp heic heif pdf docx xlsx csv txt md json yaml yml log html htm xml svg ts tsx js jsx mjs cjs py sh css sql"
).split(" ");
export const SNIFF_CHECKED: readonly string[] = "png jpg jpeg gif webp heic heif pdf docx xlsx".split(" ");
export const MACRO_EXTENSIONS: readonly string[] = "docm xlsm pptm dotm xltm".split(" ");

export type AuditVerdict = { verdict: "allowed" } | { verdict: "blocked"; reason: string } | { verdict: "unreadable" };

export type TypeLabel = "zip" | "exe" | "docm" | "xlsm" | "office-cu" | "pptx" | "media" | "khac";

const ALLOWED = new Set(ALLOWED_EXTENSIONS);
const SNIFFED = new Set(SNIFF_CHECKED);
const MACRO = new Set(MACRO_EXTENSIONS);

/** Same table as `EXTENSION_LABELS` in apps/crew-mac/src/files/policy.ts; the macro extensions go through it too. */
export const EXTENSION_LABELS: Readonly<Record<Exclude<TypeLabel, "khac">, readonly string[]>> = {
  zip: ["zip", "7z", "rar", "gz", "tgz", "tar", "bz2", "xz"],
  exe: ["exe", "msi", "dmg", "pkg", "app", "bat", "cmd", "com", "scr", "dll", "dylib", "jar", "apk"],
  docm: ["docm", "dotm"],
  xlsm: ["xlsm", "xltm"],
  "office-cu": ["doc", "xls", "ppt", "dot", "xlt", "pot"],
  pptx: ["pptx", "pptm", "ppsx", "potx"],
  media: ["mp3", "mp4", "m4a", "m4v", "mov", "wav", "avi", "mkv", "webm", "aac", "flac", "ogg", "aiff"],
};

export function labelForExtension(ext: string | null): TypeLabel {
  if (!ext) return "khac";
  for (const [label, exts] of Object.entries(EXTENSION_LABELS)) if (exts.includes(ext)) return label as TypeLabel;
  return "khac";
}

const allowed: AuditVerdict = { verdict: "allowed" };
const blockedType = (label: TypeLabel): AuditVerdict => ({ verdict: "blocked", reason: `kiểu file không được phép (${label})` });
const blockedMacro = (label: string): AuditVerdict => ({ verdict: "blocked", reason: `tài liệu Office có macro (${label})` });

function extensionOf(filename: string | null): string | null {
  if (!filename) return null;
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return null;
  return filename.slice(dot + 1).toLowerCase();
}

/**
 * Declared type of a file whose extension is not allowed: only refines the label when the extension says
 * nothing. It never blocks an allowed extension (a browser labels `.ts` as `video/mp2t`, a clean `.xlsx` as
 * macro-enabled, a `.docx` as `application/zip`); for those the Mac decides from the bytes.
 */
function labelByContentType(contentType: string): { macro: TypeLabel } | { type: TypeLabel } | null {
  const type = contentType.toLowerCase().split(";")[0]!.trim();
  if (type.includes("macroenabled")) {
    if (type.includes("word")) return { macro: "docm" };
    if (type.includes("excel")) return { macro: "xlsm" };
    return { macro: "pptx" };
  }
  if ([
    "application/x-msdownload", "application/x-msdos-program", "application/vnd.microsoft.portable-executable",
    "application/x-dosexec", "application/x-executable", "application/x-mach-binary", "application/x-elf",
    "application/x-sharedlib", "application/x-apple-diskimage",
  ].includes(type)) return { type: "exe" };
  if ([
    "application/zip", "application/x-zip-compressed", "application/x-7z-compressed", "application/x-rar-compressed",
    "application/vnd.rar", "application/gzip", "application/x-gzip", "application/x-tar", "application/x-bzip2",
  ].includes(type)) return { type: "zip" };
  return null;
}

/** Verdict from name and declared type only, or `"needs-bytes"` when the first bytes must be checked. */
export function judgeByName(filename: string | null, contentType: string): AuditVerdict | "needs-bytes" {
  const ext = extensionOf(filename);
  if (ext && MACRO.has(ext)) return blockedMacro(labelForExtension(ext));
  if (ext && ALLOWED.has(ext)) return SNIFFED.has(ext) ? "needs-bytes" : allowed;
  const byExtension = labelForExtension(ext);
  if (byExtension !== "khac") return blockedType(byExtension);
  const byType = labelByContentType(contentType);
  if (byType && "macro" in byType) return blockedMacro(byType.macro);
  return blockedType(byType ? byType.type : "khac");
}

const EXECUTABLE_SIGNATURES: readonly (readonly number[])[] = [
  [0x4d, 0x5a], // MZ (PE)
  [0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe], // Mach-O
  [0xca, 0xfe, 0xba, 0xbe], // Mach-O universal
  [0x7f, 0x45, 0x4c, 0x46], // ELF
];

/** Verdict from the first bytes of a signature-checked attachment. Reads at most 16 bytes. */
export function judgeBytes(_filename: string, head: Uint8Array): AuditVerdict {
  const start = head.subarray(0, 16);
  const executable = EXECUTABLE_SIGNATURES.some((signature) =>
    start.length >= signature.length && signature.every((byte, i) => start[i] === byte));
  return executable ? blockedType("exe") : allowed;
}

const MAX_FILENAME_CHARS = 120;

/** Name safe to put inside a markdown code span: no control/format characters, no backtick, ≤ 120 characters. */
export function sanitizeFilename(name: string | null): string {
  const cleaned = Array.from((name ?? "").replace(/[\p{Cc}\p{Cf}`]/gu, "").trim()).slice(0, MAX_FILENAME_CHARS).join("");
  return cleaned || "(không tên)";
}
