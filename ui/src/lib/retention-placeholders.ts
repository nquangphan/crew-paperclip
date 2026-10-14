// Placeholders for stored content that retention removed after the fact:
// the owner prunes run logs older than 7 days, and attachment files can go
// missing from storage. Old tickets must still render around these gaps.

/** Shown where a run's activity log used to be. */
export const RUN_LOG_MISSING_LABEL = "Log đã được dọn sau 7 ngày";

/** Shown in place of an attachment or asset whose stored file is gone. */
export const MISSING_FILE_LABEL = "File không còn";
