import { describe, expect, it } from "vitest";
import { sessionCodec } from "./index.js";

const remoteExecution = {
  transport: "ssh",
  host: "100.64.0.1",
  port: 2222,
  username: "agent",
  remoteCwd: "/Users/agent/worktrees/a",
};

describe("opencode_local session codec (Crew)", () => {
  it("keeps the remote execution identity through serialize and deserialize", () => {
    const stored = sessionCodec.serialize({
      sessionId: "ses_123",
      cwd: "/Users/agent/worktrees/a",
      remoteExecution,
    });
    expect(stored).toMatchObject({ remoteExecution });
    expect(sessionCodec.deserialize(stored)).toMatchObject({
      sessionId: "ses_123",
      cwd: "/Users/agent/worktrees/a",
      remoteExecution,
    });
  });

  it("keeps the remote execution identity when the session id uses the OpenCode sessionID key", () => {
    const stored = sessionCodec.serialize({ sessionID: "ses_456", remoteExecution });
    expect(stored).toMatchObject({ sessionId: "ses_456", remoteExecution });
    expect(sessionCodec.deserialize({ sessionID: "ses_456", remoteExecution })).toMatchObject({
      sessionId: "ses_456",
      remoteExecution,
    });
  });

  it("omits remote execution for local sessions and non-object values", () => {
    const stored = sessionCodec.serialize({ sessionId: "ses_123" });
    expect(stored).not.toHaveProperty("remoteExecution");
    expect(sessionCodec.deserialize({ sessionId: "s-1", remoteExecution: "not-an-object" })).not.toHaveProperty(
      "remoteExecution",
    );
    expect(sessionCodec.deserialize({ sessionId: "s-1", remoteExecution: [1] })).not.toHaveProperty("remoteExecution");
  });
});
