CREATE TABLE plugin_crew_core_0433ea20b6.crew_attachment_audit (
  attachment_id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  issue_id uuid NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('allowed', 'blocked', 'unreadable')),
  reason text,
  warned_at timestamptz,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crew_attachment_audit_issue_idx ON plugin_crew_core_0433ea20b6.crew_attachment_audit (issue_id);
