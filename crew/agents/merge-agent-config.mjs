#!/usr/bin/env node
// Reads a Paperclip agent JSON on stdin and prints the PATCH /agents/:id body that pins Superpowers.
// Roles are not stored on the agent: the server reads them from CREW_POLICY_CONFIG (see policy-config.mjs).
// Usage: merge-agent-config.mjs <pinned plugin dir>
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OWNED_FLAGS = new Set(["--setting-sources", "--plugin-dir"]);
const PIN_RE = /^\/.+\/\.crew\/workflows\/superpowers\/[^/]+$/;

function isOwnedFlag(arg) {
  return OWNED_FLAGS.has(arg) || [...OWNED_FLAGS].some((flag) => arg.startsWith(`${flag}=`));
}

export function mergeAgentConfig(agent, pinDir) {
  if (typeof pinDir !== "string" || !pinDir.startsWith("/")) throw new Error(`pin dir must be absolute: ${pinDir}`);
  if (!PIN_RE.test(pinDir)) throw new Error(`pin dir must be the pinned <home>/.crew/workflows/superpowers/<version>: ${pinDir}`);
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
