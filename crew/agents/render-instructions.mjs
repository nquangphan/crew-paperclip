#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROLES = new Set(["executor", "reviewer", "integrator", "assistant", "bmad"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function checkIds(ids, label, agentId, taken) {
  const seen = new Set();
  for (const id of ids) {
    if (!UUID_RE.test(id)) throw new Error(`${label} phải là uuid: ${id}`);
    const key = id.toLowerCase();
    if (seen.has(key) || taken.has(key)) throw new Error(`${label} trùng: ${id}`);
    if (key === agentId.toLowerCase()) throw new Error(`Trợ Lý không được nằm trong danh sách ${label} của chính nó`);
    seen.add(key);
  }
  return seen;
}

export function renderInstructions(role, text, agentId, executorIds, bmadIds = []) {
  if (!ROLES.has(role)) throw new Error(`unknown role: ${role}`);
  if (role !== "assistant") {
    if (executorIds.length > 0) throw new Error("danh sách executor chỉ assistant nhận");
    if (bmadIds.length > 0) throw new Error("danh sách agent BMAD chỉ assistant nhận");
    return text;
  }
  if (!UUID_RE.test(agentId)) throw new Error(`assistant phải là uuid: ${agentId}`);
  if (executorIds.length === 0) throw new Error("assistant cần ít nhất một executor");
  const executors = checkIds(executorIds, "executor", agentId, new Set());
  checkIds(bmadIds, "agent BMAD", agentId, executors);
  const list = executorIds.map((id) => `- \`${id}\``).join("\n");
  const bmad = bmadIds.length > 0 ? bmadIds.map((id) => `- \`${id}\``).join("\n") : "Không có. Luôn dùng Superpowers.";
  return `${text.replace(/\n*$/, "\n")}\n## Executor của company\n\n${list}\n\n## Agent BMAD của company\n\n${bmad}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [role, file, agentId, executors = "", bmad = ""] = process.argv.slice(2);
    const split = (v) => v.split(",").map((s) => s.trim()).filter(Boolean);
    const content = renderInstructions(role, readFileSync(file, "utf8"), agentId, split(executors), split(bmad));
    process.stdout.write(JSON.stringify({ path: "AGENTS.md", content }));
  } catch (error) {
    process.stderr.write(`render-instructions: ${error.message}\n`);
    process.exit(2);
  }
}
