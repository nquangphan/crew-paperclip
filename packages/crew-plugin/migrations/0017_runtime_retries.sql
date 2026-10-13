CREATE TABLE plugin_crew_core_0433ea20b6.crew_runtime_retries (
  company_id uuid NOT NULL,
  issue_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  run_id uuid NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, issue_id)
);
CREATE INDEX crew_runtime_retries_due_idx ON plugin_crew_core_0433ea20b6.crew_runtime_retries (company_id, next_at) WHERE next_at IS NOT NULL;
