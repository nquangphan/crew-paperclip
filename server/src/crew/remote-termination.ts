import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { environmentLeases, heartbeatRunEvents, heartbeatRuns, type Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { remoteTerminationReceipt } from "../services/remote-execution-termination.js";
import type { RemoteStopResult, RunLeaseReleasedInput } from "./remote-stop.js";

/**
 * Termination receipt for SSH run leases.
 *
 * Stock continuation (`admitExplicitNativeContinuation`, `resumeRemoteStopComments`) only lets a new user
 * turn start after a remote run once every lease of that run carries a provider termination receipt
 * (`hasRemoteTerminationReceipt`). The stock SSH driver never writes one, so a task held by execution
 * recovery whose last run used an SSH environment deferred every later user message forever
 * (`executionWait.reason = "remote_cleanup"`).
 *
 * Crew already stops the run on the SSH host when the lease is released (H3, `stopRemoteRunOnRelease`).
 * This module turns that into the same receipt a sandbox provider gives, from one of two proofs:
 * - `remote_stop_verified`: the stop command on the host ran and found no process of the run left
 *   (`outcome = "stopped"`, `remaining = 0`); this is the check the load gate already trusts before it
 *   lets a new run start on the same host;
 * - `never_started`: the host was not reachable, but the server-side record proves the adapter was never
 *   invoked for this run (see `legacyRunNeverLaunched`).
 * Anything else (unreachable host for a run that did launch, stop incomplete, stop failed) records no
 * receipt, and the continuation gate keeps holding the message as before.
 */
export type SshTerminationProof = "remote_stop_verified" | "never_started";

/** Cancellation codes written before the adapter is called (the run never reached `dispatch`). */
const PRE_DISPATCH_CANCEL_CODES = new Set(["legacy_disposition_repair_suppressed"]);

/**
 * True only for a legacy run that is cancelled and whose record proves no adapter process was launched:
 * no process identity, no provider session, no `adapter.invoke` event (every legacy adapter reports its
 * invocation before it spawns), and either the run was never claimed or its cancellation code is one that
 * is only written before dispatch.
 */
export async function legacyRunNeverLaunched(db: Db, companyId: string, runId: string): Promise<boolean> {
  const [run] = await db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId),
  ));
  if (!run || run.runtimeMode !== "legacy" || run.status !== "cancelled" || !run.finishedAt) return false;
  if (run.processPid || run.processGroupId || run.processStartedAt || run.sessionIdAfter) return false;
  if (run.startedAt && !PRE_DISPATCH_CANCEL_CODES.has(run.errorCode ?? "")) return false;
  const [invoked] = await db.select({ id: heartbeatRunEvents.id }).from(heartbeatRunEvents).where(and(
    eq(heartbeatRunEvents.companyId, companyId), eq(heartbeatRunEvents.runId, runId),
    eq(heartbeatRunEvents.eventType, "adapter.invoke"),
  )).limit(1);
  return !invoked;
}

export async function sshTerminationProof(
  input: RunLeaseReleasedInput,
  result: RemoteStopResult | null,
): Promise<SshTerminationProof | null> {
  const runId = input.lease.heartbeatRunId;
  if (!runId) return null;
  if (result?.outcome === "stopped" && result.remaining === 0) return "remote_stop_verified";
  return (await legacyRunNeverLaunched(input.db, input.lease.companyId, runId)) ? "never_started" : null;
}

/**
 * Writes the receipt on the released lease when a proof exists. The update is fenced to the same lease,
 * run and provider lease id, and only applies to a lease that is already released (not reacquired).
 * Returns the proof that was recorded, or null. Never throws.
 */
export async function recordSshRemoteTermination(
  input: RunLeaseReleasedInput,
  result: RemoteStopResult | null,
): Promise<SshTerminationProof | null> {
  const { db, lease } = input;
  const runId = lease.heartbeatRunId;
  if (!runId || input.environment.driver !== "ssh" || !lease.provider || lease.provider === "local" ||
      !lease.providerLeaseId) return null;
  try {
    const proof = await sshTerminationProof(input, result);
    if (!proof) return null;
    const receipt = remoteTerminationReceipt(
      { id: lease.id, companyId: lease.companyId, heartbeatRunId: runId, provider: lease.provider, providerLeaseId: lease.providerLeaseId },
      { providerLeaseId: lease.providerLeaseId, state: "stopped" },
    );
    if (!receipt) return null;
    const evidence = {
      proof, recordedAt: receipt.confirmedAt,
      ...(result ? { stopOutcome: result.outcome, matched: result.matched ?? null, remaining: result.remaining ?? null } : {}),
    };
    const updated = await db.update(environmentLeases).set({
      cleanupStatus: "success",
      metadata: sql`coalesce(${environmentLeases.metadata}, '{}'::jsonb) || ${JSON.stringify({
        remoteExecutionTermination: receipt, crewRemoteTermination: evidence,
      })}::jsonb`,
      updatedAt: new Date(),
    }).where(and(
      eq(environmentLeases.id, lease.id), eq(environmentLeases.companyId, lease.companyId),
      eq(environmentLeases.heartbeatRunId, runId), eq(environmentLeases.provider, lease.provider),
      eq(environmentLeases.providerLeaseId, lease.providerLeaseId), isNotNull(environmentLeases.releasedAt),
      inArray(environmentLeases.status, ["released", "expired", "failed"]),
    )).returning({ id: environmentLeases.id });
    if (updated.length === 0) return null;
    logger.info({ runId, leaseId: lease.id, proof }, "crew: recorded SSH termination receipt");
    return proof;
  } catch (err) {
    logger.warn({ err, runId, leaseId: lease.id }, "crew: failed to record SSH termination receipt");
    return null;
  }
}

type ResumeFn = (runId: string, companyId: string) => Promise<void>;

/** Stock re-evaluation of messages saved behind this run (imported lazily: heartbeat imports the Crew hooks). */
async function stockResume(db: Db): Promise<ResumeFn> {
  const { heartbeatService } = await import("../services/heartbeat.js");
  const heartbeat = heartbeatService(db);
  return async (runId, companyId) => {
    const [run] = await db.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId),
    ));
    if (run) await heartbeat.resumeRemoteStopComments(run);
  };
}

/**
 * Records the receipt, then asks stock admission to re-evaluate user messages that were deferred while the
 * receipt was missing. The periodic `resumeExecutionWaitComments` sweep would also pick them up; this only
 * removes the wait. Never throws.
 */
export async function settleSshRemoteTermination(
  input: RunLeaseReleasedInput,
  result: RemoteStopResult | null,
  resume?: ResumeFn,
): Promise<SshTerminationProof | null> {
  const proof = await recordSshRemoteTermination(input, result);
  if (!proof) return null;
  const runId = input.lease.heartbeatRunId as string;
  try {
    await (resume ?? await stockResume(input.db))(runId, input.lease.companyId);
  } catch (err) {
    logger.warn({ err, runId }, "crew: failed to resume saved messages after SSH termination receipt");
  }
  return proof;
}
