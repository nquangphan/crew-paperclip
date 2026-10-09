#!/usr/bin/env node
// Reads a Paperclip agent JSON on stdin and prints the PATCH /agents/:id body that pins Superpowers or BMAD.
// Roles are not stored on the agent: the server reads them from CREW_POLICY_CONFIG (see policy-config.mjs).
// Usage: merge-agent-config.mjs <pinned plugin dir>
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OWNED_FLAGS = new Set(["--setting-sources", "--plugin-dir"]);
const WRAPPER_RE = /^\/.+\/\.crew\/bin\/crew-claude-run$/;
const PIN_RE = /^\/.+\/\.crew\/workflows\/(superpowers|bmad)\/(?!\.\.?$)[^/]+$/;

function isOwnedFlag(arg) {
  return OWNED_FLAGS.has(arg) || [...OWNED_FLAGS].some((flag) => arg.startsWith(`${flag}=`));
}

function findRedacted(value, path) {
  if (value === "***REDACTED***") return path;
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (path === "adapterConfig" && key === "env") continue; // the server restores redacted env values on PATCH
      const hit = findRedacted(child, `${path}.${key}`);
      if (hit) return hit;
    }
  }
  return null;
}

export function mergeAgentConfig(agent, pinDir) {
  if (!agent || typeof agent !== "object" || typeof agent.id !== "string" || agent.id === "") {
    throw new Error("input is not a Paperclip agent (missing id): refusing to patch");
  }
  const config = agent.adapterConfig;
  if (!config || typeof config !== "object" || Array.isArray(config) || typeof config.command !== "string" || config.command === "") {
    throw new Error("agent has no adapterConfig.command: refusing to replace its adapterConfig");
  }
  if (!WRAPPER_RE.test(config.command)) {
    throw new Error(`adapterConfig.command must be the absolute <home>/.crew/bin/crew-claude-run wrapper, got ${config.command}: pinning a workflow without the wrapper skips its checks`);
  }
  const redacted = findRedacted(config, "adapterConfig");
  if (redacted) throw new Error(`${redacted} is redacted by the server and would be overwritten: refusing to patch`);
  if (typeof pinDir !== "string" || !pinDir.startsWith("/")) throw new Error(`pin dir must be absolute: ${pinDir}`);
  if (!PIN_RE.test(pinDir)) throw new Error(`pin dir must be the pinned <home>/.crew/workflows/superpowers/<version> or <home>/.crew/workflows/bmad/<version>: ${pinDir}`);
  const adapterConfig = { ...(agent.adapterConfig ?? {}) };
  const previous = Array.isArray(adapterConfig.extraArgs) ? adapterConfig.extraArgs : [];
  const kept = [];
  for (let i = 0; i < previous.length; i++) {
    const arg = previous[i];
    if (!isOwnedFlag(arg)) {
      kept.push(arg);
    } else if (OWNED_FLAGS.has(arg)) {
      i++; // the value of a two-token flag
    }
  }
  adapterConfig.extraArgs = [...kept, "--setting-sources", "project,local", "--plugin-dir", pinDir];
  return { adapterConfig };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const agent = JSON.parse(readFileSync(0, "utf8"));
    process.stdout.write(JSON.stringify(mergeAgentConfig(agent, process.argv[2])));
  } catch (error) {
    process.stderr.write(`merge-agent-config: ${error.message}\n`);
    process.exit(2);
  }
}
