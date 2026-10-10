import { sessionCodec as acpxSessionCodec } from "@paperclipai/adapter-utils/acpx-engine/session-codec";
import { describe, expect, it } from "vitest";
import { sessionCodec } from "./index.js";

const remoteExecution = {
  transport: "ssh",
  host: "100.64.0.1",
  port: 2222,
  username: "agent",
  remoteCwd: "/Users/agent/worktrees/a",
};

describe("codex_local session codec (Crew)", () => {
  it("keeps the remote execution identity through serialize and deserialize", () => {
    const stored = sessionCodec.serialize({
      sessionId: "019a0000-0000-7000-8000-000000000001",
      cwd: "/Users/agent/worktrees/a",
      remoteExecution,
    });
    expect(stored).toMatchObject({ remoteExecution });
    expect(sessionCodec.deserialize(stored)).toMatchObject({
      sessionId: "019a0000-0000-7000-8000-000000000001",
      cwd: "/Users/agent/worktrees/a",
      remoteExecution,
    });
  });

  it("omits remote execution for local sessions and non-object values", () => {
    const stored = sessionCodec.serialize({ sessionId: "019a0000-0000-7000-8000-000000000001" });
    expect(stored).not.toHaveProperty("remoteExecution");
    expect(sessionCodec.deserialize({ sessionId: "s-1", remoteExecution: "not-an-object" })).not.toHaveProperty(
      "remoteExecution",
    );
    expect(sessionCodec.deserialize({ sessionId: "s-1", remoteExecution: [1] })).not.toHaveProperty("remoteExecution");
  });

  it("leaves the acpx branch unchanged when there is no sessionId", () => {
    const params = { cwd: "/Users/agent/worktrees/a", remoteExecution };
    expect(sessionCodec.serialize(params)).toEqual(acpxSessionCodec.serialize(params));
    expect(sessionCodec.deserialize(params)).toEqual(acpxSessionCodec.deserialize(params));
  });
});
