import type { Environment } from "@paperclipai/shared";

/**
 * SSH lease metadata that opts the run into in-place realization. An SSH
 * environment whose metadata sets `workspaceRealizationMode: "in_place"` runs
 * the agent directly in its remote workspace path; anything else keeps copy.
 */
export function sshLeaseWorkspaceRealization(
  environment: Pick<Environment, "metadata">,
): { workspaceRealization?: { mode: "in_place" } } {
  const metadata = environment.metadata;
  const mode =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).workspaceRealizationMode
      : undefined;
  return mode === "in_place" ? { workspaceRealization: { mode: "in_place" } } : {};
}
