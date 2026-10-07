#!/usr/bin/env node
// Prints the CREW_POLICY_CONFIG JSON with one company's Crew roles set. Never touches the server.
// Without a config file argument the output holds only that company: copying it over the live file drops the
// other companies. Pass the live file to merge into it. The server rereads the file on every gated write.
// Usage: policy-config.mjs <companyId> <reviewerAgentId> <integratorAgentId> <ownerUserId> [existing config file]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildPolicyConfig(existingText, companyId, roles) {
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

  let companies = {};
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
    companies = Object.fromEntries(Object.entries(parsed.companies).filter(([key]) => key.toLowerCase() !== companyKey));
  }
  return {
    companies: {
      ...companies,
      [companyKey]: { reviewerAgentId, integratorAgentId, ownerUserId: ownerUserId.trim() },
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [companyId, reviewerAgentId, integratorAgentId, ownerUserId, existingFile] = process.argv.slice(2);
    const existing = existingFile ? readFileSync(existingFile, "utf8") : null;
    const config = buildPolicyConfig(existing, companyId, { reviewerAgentId, integratorAgentId, ownerUserId });
    process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`policy-config: ${error.message}\n`);
    process.exit(2);
  }
}
