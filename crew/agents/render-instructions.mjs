#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROLES = new Set(["executor", "reviewer", "integrator", "assistant"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function renderInstructions(role, text, agentId, executorIds) {
  if (!ROLES.has(role)) throw new Error(`unknown role: ${role}`);
  if (role !== "assistant") {
    if (executorIds.length > 0) throw new Error("danh sách executor chỉ assistant nhận");
    return text;
  }
  if (!UUID_RE.test(agentId)) throw new Error(`assistant phải là uuid: ${agentId}`);
  if (executorIds.length === 0) throw new Error("assistant cần ít nhất một executor");
  const seen = new Set();
  for (const id of executorIds) {
    if (!UUID_RE.test(id)) throw new Error(`executor phải là uuid: ${id}`);
    const key = id.toLowerCase();
    if (seen.has(key)) throw new Error(`executor trùng: ${id}`);
    if (key === agentId.toLowerCase()) throw new Error("Trợ Lý không được nằm trong danh sách executor của chính nó");
    seen.add(key);
  }
  const list = executorIds.map((id) => `- \`${id}\``).join("\n");
  return `${text.replace(/\n*$/, "\n")}\n## Executor của company\n\n${list}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [role, file, agentId, executors = ""] = process.argv.slice(2);
    const executorIds = executors.split(",").map((s) => s.trim()).filter(Boolean);
    const content = renderInstructions(role, readFileSync(file, "utf8"), agentId, executorIds);
    process.stdout.write(JSON.stringify({ path: "AGENTS.md", content }));
  } catch (error) {
    process.stderr.write(`render-instructions: ${error.message}\n`);
    process.exit(2);
  }
}
