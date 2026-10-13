import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { execute } from "./execute.js";
import { detectClaudeLoginRequired } from "./parse.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

// A tool result that prints an OpenAPI diff. The words "Unauthorized" and 401
// come from the API the agent inspected, not from Claude's own login state.
const toolOutputEvent = {
  type: "user",
  session_id: SESSION_ID,
  message: {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "toolu_1",
        content: '  responses:\n    "401": {"description": "Unauthorized"}\n',
      },
    ],
  },
};

const successResult = {
  type: "result",
  subtype: "success",
  is_error: false,
  session_id: SESSION_ID,
  result: "Done.",
  usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 },
};

const loginRequiredResult = {
  type: "result",
  subtype: "success",
  is_error: true,
  session_id: SESSION_ID,
  result: "Invalid API key · Please run /login",
};

function streamOf(...events: Record<string, unknown>[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n");
}

async function runFakeClaude(input: { stdout: string; exitCode: number }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "crew-claude-auth-"));
  const workspace = path.join(root, "workspace");
  const commandPath = path.join(root, "claude");
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(
    commandPath,
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(`${input.stdout}\n`)});\nprocess.exit(${input.exitCode});\n`,
    "utf8",
  );
  await fs.chmod(commandPath, 0o755);
  const previousHome = process.env.HOME;
  process.env.HOME = root;
  try {
    return await execute({
      runId: "run-auth-classification",
      agent: { id: "agent-1", companyId: "co-1", name: "Test", adapterType: "claude_local", adapterConfig: { engine: "cli" } },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { engine: "cli", command: commandPath, cwd: workspace, promptTemplate: "Do work." },
      context: {},
      authToken: "tok",
      onLog: async () => {},
    });
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("Claude auth classification ignores tool output (Crew)", () => {
  it("does not flag a successful result whose tool output says Unauthorized", () => {
    expect(
      detectClaudeLoginRequired({
        parsed: successResult,
        stdout: streamOf(toolOutputEvent, successResult),
        stderr: "",
      }).requiresLogin,
    ).toBe(false);
  });

  it("does not flag tool output that says Unauthorized when no result was parsed", () => {
    expect(
      detectClaudeLoginRequired({ parsed: null, stdout: streamOf(toolOutputEvent), stderr: "" }).requiresLogin,
    ).toBe(false);
  });

  it("still flags a failed result that asks to run /login", () => {
    expect(
      detectClaudeLoginRequired({
        parsed: loginRequiredResult,
        stdout: streamOf(loginRequiredResult),
        stderr: "",
      }).requiresLogin,
    ).toBe(true);
  });

  it("still flags Claude's own plain-text login prompt on stdout or stderr", () => {
    expect(detectClaudeLoginRequired({ parsed: null, stdout: "Not logged in · Please run /login", stderr: "" }).requiresLogin).toBe(true);
    expect(detectClaudeLoginRequired({ parsed: null, stdout: "", stderr: "Invalid API key · Please run /login" }).requiresLogin).toBe(true);
  });

  it("still flags Claude's synthetic error assistant event when the run stopped before a result", () => {
    const syntheticError = {
      type: "assistant",
      error: "authentication_failed",
      message: { model: "<synthetic>", content: [{ type: "text", text: "Invalid API key · Please run /login" }] },
    };
    expect(detectClaudeLoginRequired({ parsed: null, stdout: streamOf(syntheticError), stderr: "" }).requiresLogin).toBe(true);
  });

  it("still flags an is_error result with an expired OAuth token", () => {
    const parsed = { type: "result", is_error: true, result: "Failed to authenticate. Your OAuth access token is expired." };
    expect(detectClaudeLoginRequired({ parsed, stdout: streamOf(parsed), stderr: "" }).requiresLogin).toBe(true);
  });

  it("does not classify a successful run that exits 255 with Unauthorized tool output as claude_auth_required", async () => {
    const result = await runFakeClaude({
      stdout: streamOf(
        { type: "system", subtype: "init", session_id: SESSION_ID, model: "claude-sonnet" },
        toolOutputEvent,
        successResult,
      ),
      exitCode: 255,
    });
    expect(result.exitCode).toBe(255);
    expect(result.errorCode).not.toBe("claude_auth_required");
  });

  it("classifies a real login-required run as claude_auth_required", async () => {
    const result = await runFakeClaude({ stdout: streamOf(loginRequiredResult), exitCode: 1 });
    expect(result.errorCode).toBe("claude_auth_required");
  });
});
