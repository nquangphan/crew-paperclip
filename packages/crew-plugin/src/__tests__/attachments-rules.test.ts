import { describe, expect, it } from "vitest";
import {
  ALLOWED_EXTENSIONS,
  judgeBytes,
  EXTENSION_LABELS,
  judgeByName,
  labelForExtension,
  MACRO_EXTENSIONS,
  sanitizeFilename,
  SNIFF_CHECKED,
} from "../attachments/rules.js";

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string, pad = 16) => {
  const out = new Uint8Array(Math.max(pad, text.length));
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
};
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46);
const MACHO = bytes(0xcf, 0xfa, 0xed, 0xfe, 0x07, 0, 0, 0x01, 0x03, 0, 0, 0);
const PK = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0x06, 0);
const blocked = (reason: string) => ({ verdict: "blocked", reason });
const allowed = { verdict: "allowed" };

describe("bảng kiểu file (giống bản crew-mac)", () => {
  it("đúng nguyên văn danh sách cho phép, nhóm kiểm chữ ký và nhóm macro", () => {
    expect(ALLOWED_EXTENSIONS.join(" ")).toBe(
      "png jpg jpeg gif webp heic heif pdf docx xlsx csv txt md json yaml yml log html htm xml svg ts tsx js jsx mjs cjs py sh css sql",
    );
    expect(SNIFF_CHECKED.join(" ")).toBe("png jpg jpeg gif webp heic heif pdf docx xlsx");
    expect(MACRO_EXTENSIONS.join(" ")).toBe("docm xlsm pptm dotm xltm");
  });
});

// Bản chép bảng EXTENSION_LABELS của apps/crew-mac/src/files/policy.ts: đổi một bên thì đổi bên kia.
const MAC_EXTENSION_LABELS = {
  zip: "zip 7z rar gz tgz tar bz2 xz",
  exe: "exe msi dmg pkg app bat cmd com scr dll dylib jar apk",
  docm: "docm dotm",
  xlsm: "xlsm xltm",
  "office-cu": "doc xls ppt dot xlt pot",
  pptx: "pptx pptm ppsx potx",
  media: "mp3 mp4 m4a m4v mov wav avi mkv webm aac flac ogg aiff",
};

describe("bảng đuôi → nhãn (giống bản crew-mac)", () => {
  it("đúng nguyên văn từng nhãn", () => {
    expect(Object.fromEntries(Object.entries(EXTENSION_LABELS).map(([label, exts]) => [label, exts.join(" ")])))
      .toEqual(MAC_EXTENSION_LABELS);
  });

  it("đuôi lệch trước đây giờ ra đúng nhãn của Mac", () => {
    for (const ext of ["ps1", "vbs", "deb", "rpm", "so", "pps", "wmv"]) expect(labelForExtension(ext)).toBe("khac");
    expect(labelForExtension("aiff")).toBe("media");
    for (const ext of Object.values(MAC_EXTENSION_LABELS).join(" ").split(" ")) {
      expect(labelForExtension(ext)).not.toBe("khac");
    }
    expect(judgeByName("x.pptm", "")).toEqual(blocked("tài liệu Office có macro (pptx)"));
    expect(judgeByName("x.dotm", "")).toEqual(blocked("tài liệu Office có macro (docm)"));
    expect(judgeByName("x.xltm", "")).toEqual(blocked("tài liệu Office có macro (xlsm)"));
    expect(judgeByName("x.ps1", "")).toEqual(blocked("kiểu file không được phép (khac)"));
    expect(judgeByName("x.aiff", "")).toEqual(blocked("kiểu file không được phép (media)"));
  });
});

describe("judgeByName", () => {
  it("chặn theo đuôi với lý do cố định", () => {
    expect(judgeByName("tool.zip", "application/zip")).toEqual(blocked("kiểu file không được phép (zip)"));
    expect(judgeByName("a.docm", "application/vnd.ms-word.document.macroEnabled.12"))
      .toEqual(blocked("tài liệu Office có macro (docm)"));
    expect(judgeByName("B.XLSM", "application/octet-stream")).toEqual(blocked("tài liệu Office có macro (xlsm)"));
    expect(judgeByName("a.exe", "application/x-msdownload")).toEqual(blocked("kiểu file không được phép (exe)"));
    expect(judgeByName("a.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"))
      .toEqual(blocked("kiểu file không được phép (pptx)"));
    expect(judgeByName("a.mp4", "video/mp4")).toEqual(blocked("kiểu file không được phép (media)"));
    expect(judgeByName("a.doc", "application/msword")).toEqual(blocked("kiểu file không được phép (office-cu)"));
    expect(judgeByName("README", "text/plain")).toEqual(blocked("kiểu file không được phép (khac)"));
    expect(judgeByName(null, "image/png")).toEqual(blocked("kiểu file không được phép (khac)"));
    expect(judgeByName("a.bin", "application/octet-stream")).toEqual(blocked("kiểu file không được phép (khac)"));
  });

  it("cho qua đuôi không cần đọc byte, đòi byte với nhóm kiểm chữ ký", () => {
    expect(judgeByName("a.md", "text/markdown")).toEqual(allowed);
    // Trình duyệt gán video/mp2t cho .ts: đuôi cho phép thì kiểu media khai báo không làm chặn.
    expect(judgeByName("index.ts", "video/mp2t")).toEqual(allowed);
    expect(judgeByName("a.png", "image/png")).toBe("needs-bytes");
    expect(judgeByName("Scan.PDF", "application/pdf")).toBe("needs-bytes");
    expect(judgeByName("a.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("needs-bytes");
  });

  it("contentType khai báo không chặn đuôi được phép: để Mac quyết theo byte", () => {
    expect(judgeByName("run.sh", "application/x-msdownload")).toEqual(allowed);
    expect(judgeByName("notes.txt", "application/zip")).toEqual(allowed);
    expect(judgeByName("report.docx", "application/vnd.ms-word.document.macroEnabled.12")).toBe("needs-bytes");
    expect(judgeByName("data.xlsx", "application/vnd.ms-excel.sheet.macroEnabled.12")).toBe("needs-bytes");
    expect(judgeByName("a.docx", "application/zip")).toBe("needs-bytes");
  });

  it("contentType chỉ làm rõ nhãn khi đuôi không được phép và không có nhãn", () => {
    expect(judgeByName("blob.bin", "application/zip")).toEqual(blocked("kiểu file không được phép (zip)"));
    expect(judgeByName("blob.bin", "application/x-msdownload")).toEqual(blocked("kiểu file không được phép (exe)"));
    expect(judgeByName("blob.bin", "application/vnd.ms-excel.sheet.macroEnabled.12"))
      .toEqual(blocked("tài liệu Office có macro (xlsm)"));
    expect(judgeByName("blob.bin", "application/vnd.ms-powerpoint.presentation.macroEnabled.12"))
      .toEqual(blocked("tài liệu Office có macro (pptx)"));
    // Đuôi đã có nhãn thì giữ nhãn theo đuôi.
    expect(judgeByName("a.mp4", "application/zip")).toEqual(blocked("kiểu file không được phép (media)"));
  });
});

describe("judgeBytes", () => {
  it("bắt file thực thi đổi đuôi, cho qua chữ ký hợp lệ", () => {
    expect(judgeBytes("a.png", MACHO)).toEqual(blocked("kiểu file không được phép (exe)"));
    expect(judgeBytes("a.pdf", ascii("MZ\x90\x00"))).toEqual(blocked("kiểu file không được phép (exe)"));
    expect(judgeBytes("a.jpg", bytes(0x7f, 0x45, 0x4c, 0x46, 2, 1, 1))).toEqual(blocked("kiểu file không được phép (exe)"));
    for (const magic of [[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xca, 0xfe, 0xba, 0xbe]]) {
      expect(judgeBytes("a.gif", bytes(...magic, 0, 0, 0, 0))).toEqual(blocked("kiểu file không được phép (exe)"));
    }
    expect(judgeBytes("a.png", PNG)).toEqual(allowed);
    expect(judgeBytes("a.docx", PK)).toEqual(allowed);
    expect(judgeBytes("a.pdf", ascii("%PDF-1.7"))).toEqual(allowed);
    // Lệch kiểu nhưng không phải file thực thi: Mac tự nhận diện theo byte.
    expect(judgeBytes("a.png", JPEG)).toEqual(allowed);
    expect(judgeBytes("a.png", new Uint8Array())).toEqual(allowed);
  });

  it("chỉ xét 16 byte đầu", () => {
    const head = new Uint8Array(64);
    head.set([0x4d, 0x5a], 20);
    expect(judgeBytes("a.png", head)).toEqual(allowed);
  });
});

describe("sanitizeFilename", () => {
  it("bỏ ký tự điều khiển, backtick, xuống dòng; giới hạn 120 ký tự; null thành (không tên)", () => {
    expect(sanitizeFilename("a`b\nc.zip")).toBe("abc.zip");
    expect(sanitizeFilename("x‮gnp.exe")).toBe("xgnp.exe");
    expect(sanitizeFilename("\t\r")).toBe("(không tên)");
    expect(sanitizeFilename(null)).toBe("(không tên)");
    const long = `${"ả".repeat(200)}.zip`;
    expect(Array.from(sanitizeFilename(long))).toHaveLength(120);
  });
});
