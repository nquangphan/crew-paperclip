#!/usr/bin/env node
// Reads a Paperclip agent JSON on stdin and prints the PATCH /agents/:id body that pins Superpowers or BMAD.
// Roles are not stored on the agent: the server reads them from CREW_POLICY_CONFIG (see policy-config.mjs).
// Usage: merge-agent-config.mjs <pinned plugin dir> [expected runtime]
// The wrapper must match agent.adapterType: crew-claude-run (claude_local, default), crew-codex-run (codex_local),
// crew-opencode-run (opencode_local). Only Claude gets --plugin-dir; Codex and OpenCode read the pin through the
// CREW_SUPERPOWERS_DIR their wrapper exports. A Codex agent must keep CODEX_HOME outside the server's
// companies/<companyId> tree (a managed CODEX_HOME without auth.json makes the server answer configuration_incomplete)
// and must not carry OPENAI_API_KEY.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OWNED_FLAGS = new Set(["--setting-sources", "--plugin-dir"]);
const WRAPPERS = {
  claude_local: { name: "crew-claude-run", re: /^\/.+\/\.crew\/bin\/crew-claude-run$/ },
  codex_local: { name: "crew-codex-run", re: /^\/.+\/\.crew\/bin\/crew-codex-run$/ },
  opencode_local: { name: "crew-opencode-run", re: /^\/.+\/\.crew\/bin\/crew-opencode-run$/ },
};
const MANAGED_HOME_RE = /(^|\/)companies\/[^/]+/;
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

function envString(env, key) {
  const raw = env?.[key];
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw.type === "plain" ? raw.value : undefined) : raw;
  return typeof value === "string" ? value : undefined;
}

function checkCodexEnv(env) {
  if (env && typeof env === "object" && "OPENAI_API_KEY" in env) {
    throw new Error("codex_local agent must not set env.OPENAI_API_KEY: Codex logs in through the Mac's own auth, and the key would reach the server");
  }
  const home = envString(env, "CODEX_HOME");
  if (!home || home === "***REDACTED***") {
    throw new Error("codex_local agent needs a plain env.CODEX_HOME outside the companies/<companyId> tree (a managed one fails with configuration_incomplete)");
  }
  if (!home.startsWith("/")) throw new Error(`env.CODEX_HOME must be an absolute path (tuyệt đối), got ${home}`);
  if (MANAGED_HOME_RE.test(home)) throw new Error(`env.CODEX_HOME must be outside the server's companies/<companyId> tree, got ${home}`);
}

export function mergeAgentConfig(agent, pinDir, expectedRuntime) {
  if (!agent || typeof agent !== "object" || typeof agent.id !== "string" || agent.id === "") {
    throw new Error("input is not a Paperclip agent (missing id): refusing to patch");
  }
  const config = agent.adapterConfig;
  if (!config || typeof config !== "object" || Array.isArray(config) || typeof config.command !== "string" || config.command === "") {
    throw new Error("agent has no adapterConfig.command: refusing to replace its adapterConfig");
  }
  const runtime = agent.adapterType ?? "claude_local";
  const wrapper = WRAPPERS[runtime];
  if (!wrapper) throw new Error(`unsupported adapterType ${String(runtime)}: expected claude_local, codex_local or opencode_local`);
  if (expectedRuntime !== undefined) {
    if (!WRAPPERS[expectedRuntime]) throw new Error(`unknown expected runtime ${String(expectedRuntime)}`);
    if (runtime !== expectedRuntime) throw new Error(`agent runs ${runtime} but this slot needs ${expectedRuntime}`);
  }
  if (!wrapper.re.test(config.command)) {
    throw new Error(`adapterConfig.command must be the absolute <home>/.crew/bin/${wrapper.name} wrapper for ${runtime}, got ${config.command}: pinning a workflow without the wrapper skips its checks`);
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
  if (runtime === "codex_local") checkCodexEnv(config.env);
  adapterConfig.extraArgs = runtime === "claude_local" ? [...kept, "--setting-sources", "project,local", "--plugin-dir", pinDir] : kept;
  return { adapterConfig };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const agent = JSON.parse(readFileSync(0, "utf8"));
    process.stdout.write(JSON.stringify(mergeAgentConfig(agent, process.argv[2], process.argv[3])));
  } catch (error) {
    process.stderr.write(`merge-agent-config: ${error.message}\n`);
    process.exit(2);
  }
}
