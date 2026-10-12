import { and, eq, sql } from "drizzle-orm";
import { environmentLeases, type Db } from "@paperclipai/db";
import type { Environment, EnvironmentLease } from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import { logActivity } from "../services/activity-log.js";
import { stopRemoteRunOnRelease, type RemoteStopDeps, type RemoteStopResult, type RunLeaseReleasedInput } from "./remote-stop.js";
import { legacyRunNeverLaunched, type SshTerminationProof } from "./remote-termination.js";

/**
 * `retryPendingSandboxTeardown` for SSH run leases (driver patch P8 in `crew/release/core-hooks.json`).
 *
 * Stock moves a lease to `pending_cleanup` when an orphaned active lease is recovered, or when a queued-comment
 * Interrupt asks to re-verify a released remote lease without a termination receipt. The cleanup sweep then calls the
 * driver's `retryPendingSandboxTeardown`. The stock SSH driver has none, so every attempt failed with `destroy_failed`
 * and the lease stayed in `pending_cleanup` forever, holding the task's later messages behind it.
 *
 * Here the retry returns the provider receipt `{ providerLeaseId, state: "stopped" }` (the sweep binds it to the lease
 * and releases it) only with one of the proofs `remote-termination.ts` trusts:
 * - `never_started`: the server-side record proves the adapter never ran for this legacy run (no SSH needed);
 * - `remote_stop_verified`: Crew's stop command ran on the host and found no process of the run left.
 * Anything else throws, so the sweep keeps the lease and retries with its own backoff. Each failed attempt below
 * SSH_TEARDOWN_ESCALATION_ATTEMPTS records a `crew.remote_stop` activity; when the attempts reach it, one
 * `crew.remote_stop.escalated` activity asks the owner to check the host, and later attempts only log.
 */

/** Mirrors PENDING_CLEANUP_SWEEP_ATTEMPT_CAP in heartbeat.ts (the stock sweep slows to 30 min retries there). */
export const SSH_TEARDOWN_ESCALATION_ATTEMPTS = 5;
export const SSH_TEARDOWN_ESCALATED_ACTION = "crew.remote_stop.escalated";
const ESCALATED_METADATA_KEY = "crewRemoteStopEscalatedAt";
const ATTEMPTS_METADATA_KEY = "pendingCleanupRetryAttempts";

export interface SshPendingTeardownDeps {
  stop(input: RunLeaseReleasedInput, deps: Partial<RemoteStopDeps>): Promise<RemoteStopResult>;
}

const defaultDeps: SshPendingTeardownDeps = { stop: stopRemoteRunOnRelease };

type TeardownInput = { environment: Environment | null; lease: EnvironmentLease };

/** Attempt number of the running sweep attempt (the sweep claims it in the row before calling the driver). */
async function currentAttempt(db: Db, lease: EnvironmentLease): Promise<number> {
  const [row] = await db.select({ metadata: environmentLeases.metadata }).from(environmentLeases)
    .where(eq(environmentLeases.id, lease.id));
  const value = (row?.metadata as Record<string, unknown> | null)?.[ATTEMPTS_METADATA_KEY];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

/** Same fence as the sweep's release: the lease is still in `pending_cleanup` under this sweep attempt. */
function pendingCleanupFence(lease: EnvironmentLease) {
  const attemptId = lease.metadata?.pendingCleanupAttemptId;
  return and(
    eq(environmentLeases.id, lease.id), eq(environmentLeases.companyId, lease.companyId),
    eq(environmentLeases.status, "pending_cleanup"),
    typeof attemptId === "string" ? sql`${environmentLeases.metadata}->>'pendingCleanupAttemptId' = ${attemptId}` : undefined,
  );
}

async function recordAttemptActivity(db: Db, input: TeardownInput, runId: string, result: RemoteStopResult, attempt: number) {
  await logActivity(db, {
    companyId: input.lease.companyId, actorType: "system", actorId: "crew", action: "crew.remote_stop",
    entityType: "heartbeat_run", entityId: runId, runId, issueId: input.lease.issueId,
    details: { ...result, leaseStatus: "pending_cleanup", source: "pending_cleanup_retry", attempt,
      leaseId: input.lease.id, environmentId: input.environment?.id ?? null },
  });
}

/** One escalation per lease, claimed atomically so overlapping sweeps record it once. */
async function escalate(db: Db, input: TeardownInput, runId: string, result: RemoteStopResult, attempt: number) {
  const claimed = await db.update(environmentLeases).set({
    metadata: sql`coalesce(${environmentLeases.metadata}, '{}'::jsonb) || ${JSON.stringify({
      [ESCALATED_METADATA_KEY]: new Date().toISOString(),
    })}::jsonb`,
  }).where(and(pendingCleanupFence(input.lease), sql`not (coalesce(${environmentLeases.metadata}, '{}'::jsonb) ? ${ESCALATED_METADATA_KEY})`))
    .returning({ id: environmentLeases.id });
  if (claimed.length === 0) return;
  logger.warn({ runId, leaseId: input.lease.id, attempt, outcome: result.outcome },
    "crew: SSH stop still unverified after repeated cleanup attempts; the lease keeps holding its task");
  await logActivity(db, {
    companyId: input.lease.companyId, actorType: "system", actorId: "crew", action: SSH_TEARDOWN_ESCALATED_ACTION,
    entityType: "heartbeat_run", entityId: runId, runId, issueId: input.lease.issueId,
    details: {
      leaseId: input.lease.id, environmentId: input.environment?.id ?? null, attempt,
      outcome: result.outcome, remaining: result.remaining ?? null, error: result.error ?? null,
      message: "Chưa xác minh được run đã dừng trên máy SSH sau nhiều lần thử; việc vẫn bị giữ. Kiểm tra máy rồi bấm Thử lại hoặc Interrupt.",
    },
  });
}

/**
 * Driver method body. Returns the receipt for the sweep when the run is proven stopped; throws otherwise (the message
 * is constant: the sweep never logs it, and it carries no host or credential detail).
 */
export async function retrySshPendingTeardown(
  db: Db,
  input: TeardownInput,
  deps: Partial<SshPendingTeardownDeps> = {},
): Promise<{ providerLeaseId: string; state: "stopped" }> {
  const { lease, environment } = input;
  if (lease.provider !== "ssh" || !lease.providerLeaseId) {
    throw new Error("SSH cleanup retry requires an SSH provider lease.");
  }
  const receipt = { providerLeaseId: lease.providerLeaseId, state: "stopped" as const };
  const runId = lease.heartbeatRunId;
  // Probe, device-login and setup-token leases start nothing on the host that outlives their call.
  if (!runId) return receipt;
  const d: SshPendingTeardownDeps = { ...defaultDeps, ...deps };
  const attempt = await currentAttempt(db, lease);

  let proof: SshTerminationProof | null = null;
  let result: RemoteStopResult | null = null;
  if (await legacyRunNeverLaunched(db, lease.companyId, runId)) {
    proof = "never_started";
  } else if (environment?.driver === "ssh") {
    result = await d.stop({ db, environment, lease, status: "expired" }, {
      recordActivity: async (_input, stopResult) => {
        if (attempt < SSH_TEARDOWN_ESCALATION_ATTEMPTS || stopResult.outcome === "stopped") {
          await recordAttemptActivity(db, input, runId, stopResult, attempt);
        }
      },
    });
    if (result.outcome === "stopped" && result.remaining === 0) proof = "remote_stop_verified";
  } else {
    result = { outcome: "skipped", error: environment ? "môi trường không còn là SSH" : "môi trường đã bị xoá" };
    if (attempt < SSH_TEARDOWN_ESCALATION_ATTEMPTS) await recordAttemptActivity(db, input, runId, result, attempt);
  }

  if (proof) {
    await db.update(environmentLeases).set({
      metadata: sql`coalesce(${environmentLeases.metadata}, '{}'::jsonb) || ${JSON.stringify({
        crewRemoteTermination: {
          proof, recordedAt: new Date().toISOString(), source: "pending_cleanup_retry", attempt,
          ...(result ? { stopOutcome: result.outcome, matched: result.matched ?? null, remaining: result.remaining ?? null } : {}),
        },
      })}::jsonb`,
    }).where(pendingCleanupFence(lease));
    logger.info({ runId, leaseId: lease.id, proof, attempt }, "crew: SSH cleanup retry proved the run stopped");
    return receipt;
  }

  const unverified = result as RemoteStopResult;
  if (attempt >= SSH_TEARDOWN_ESCALATION_ATTEMPTS) {
    await escalate(db, input, runId, unverified, attempt).catch((err) => {
      logger.warn({ err, runId, leaseId: lease.id }, "crew: failed to record SSH cleanup escalation");
    });
  }
  throw new Error("SSH run stop is not verified yet.");
}
