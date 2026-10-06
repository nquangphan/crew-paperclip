import { describe, expect, it } from "vitest";
import { sessionCodec } from "./index.js";

const remoteExecution = {
  transport: "ssh",
  host: "100.64.0.1",
  port: 2222,
  username: "agent",
  remoteCwd: "/Users/agent/worktrees/a",
};

describe("claude_local session codec (Crew)", () => {
  it("keeps the remote execution identity through serialize and deserialize", () => {
    const stored = sessionCodec.serialize({
      sessionId: "12345678-1234-4abc-9def-123456789012",
      cwd: "/paperclip/agent-home",
      remoteExecution,
    });
    expect(stored).toMatchObject({ remoteExecution });
    expect(sessionCodec.deserialize(stored)).toMatchObject({
      sessionId: "12345678-1234-4abc-9def-123456789012",
      remoteExecution,
    });
  });

  it("omits remote execution for local sessions and non-object values", () => {
    const stored = sessionCodec.serialize({ sessionId: "12345678-1234-4abc-9def-123456789012" });
    expect(stored).not.toHaveProperty("remoteExecution");
    expect(sessionCodec.deserialize({ sessionId: "s-1", remoteExecution: "not-an-object" })).not.toHaveProperty(
      "remoteExecution",
    );
    expect(sessionCodec.deserialize({ sessionId: "s-1", remoteExecution: [1] })).not.toHaveProperty("remoteExecution");
  });
});
