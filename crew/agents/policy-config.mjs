#!/usr/bin/env node
// Prints the CREW_POLICY_CONFIG JSON with one company's Crew roles set. Never touches the server.
// Without a config file argument the output holds only that company: copying it over the live file drops the
// other companies. Pass the live file to merge into it. The server rereads the file on every gated write.
// Usage: policy-config.mjs <companyId> <reviewerAgentId> <integratorAgentId> <ownerUserId> [existing config file] [--tracking <projectId,projectId>]
// --tracking sets trackingProjectIds (projects whose root issues get no Crew policy). Without it the company's
// existing trackingProjectIds are kept; `--tracking ""` clears them.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildPolicyConfig(existingText, companyId, roles, tracking) {
  if (typeof companyId !== "string" || !UUID_RE.test(companyId)) throw new Error(`companyId phải là uuid: ${companyId}`);
  const companyKey = companyId.toLowerCase();
  const { reviewerAgentId, integratorAgentId, ownerUserId } = roles;
  for (const [name, value] of [["reviewerAgentId", reviewerAgentId], ["integratorAgentId", integratorAgentId]]) {
    if (typeof value !== "string" || !UUID_RE.test(value)) throw new Error(`${name} phải là uuid: ${value}`);
  }
  if (reviewerAgentId.toLowerCase() === integratorAgentId.toLowerCase()) {
    throw new Error("reviewerAgentId và integratorAgentId phải khác nhau");
  }
  if (typeof ownerUserId !== "string" || ownerUserId.trim() === "") throw new Error("ownerUserId is required");

  let trackingProjectIds;
  if (tracking !== undefined) {
    if (!Array.isArray(tracking)) throw new Error("trackingProjectIds phải là mảng");
    trackingProjectIds = tracking.map((id) => {
      if (typeof id !== "string" || !UUID_RE.test(id)) throw new Error(`trackingProjectIds phải gồm uuid: ${id}`);
      return id.toLowerCase();
    });
    if (new Set(trackingProjectIds).size !== trackingProjectIds.length) throw new Error("trackingProjectIds có uuid trùng");
  }

  let companies = {};
  let previous;
  if (existingText != null) {
    let parsed;
    try {
      parsed = JSON.parse(existingText);
    } catch (error) {
      throw new Error(`file cấu hình cũ không phải JSON hợp lệ: ${error.message}`);
    }
    if (!parsed || typeof parsed !== "object" || typeof parsed.companies !== "object" || parsed.companies === null) {
      throw new Error("file cấu hình cũ thiếu object companies");
    }
    const seen = new Set();
    for (const key of Object.keys(parsed.companies)) {
      if (seen.has(key.toLowerCase())) throw new Error(`file cấu hình cũ có key company trùng khi bỏ hoa thường: ${key}`);
      seen.add(key.toLowerCase());
    }
    // Replace any existing entry for this company whatever the case of its key, so one company never has two keys.
    const old = Object.entries(parsed.companies).find(([key]) => key.toLowerCase() === companyKey);
    previous = old?.[1]?.trackingProjectIds;
    companies = Object.fromEntries(Object.entries(parsed.companies).filter(([key]) => key.toLowerCase() !== companyKey));
  }
  const kept = trackingProjectIds ?? previous;
  const entry = { reviewerAgentId, integratorAgentId, ownerUserId: ownerUserId.trim() };
  if (kept !== undefined && kept.length > 0) entry.trackingProjectIds = kept;
  return { companies: { ...companies, [companyKey]: entry } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    let tracking;
    const flag = args.indexOf("--tracking");
    if (flag !== -1) {
      if (flag !== args.length - 2) throw new Error("--tracking <uuid,uuid> phải là tham số cuối");
      tracking = args[flag + 1].split(",").map((id) => id.trim()).filter(Boolean);
      args.splice(flag, 2);
    }
    const [companyId, reviewerAgentId, integratorAgentId, ownerUserId, existingFile] = args;
    const existing = existingFile ? readFileSync(existingFile, "utf8") : null;
    const config = buildPolicyConfig(existing, companyId, { reviewerAgentId, integratorAgentId, ownerUserId }, tracking);
    process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`policy-config: ${error.message}\n`);
    process.exit(2);
  }
}
