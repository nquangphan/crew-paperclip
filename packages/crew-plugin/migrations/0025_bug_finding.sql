CREATE TABLE plugin_crew_core_0433ea20b6.crew_bug_finding_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  issue_id uuid NOT NULL,
  approval_round integer NOT NULL CONSTRAINT crew_bug_finding_runs_round_check CHECK (approval_round >= 0),
  run integer NOT NULL CONSTRAINT crew_bug_finding_runs_run_check CHECK (run BETWEEN 1 AND 3),
  request_id uuid NOT NULL CONSTRAINT crew_bug_finding_runs_request_key UNIQUE,
  machine_job_id uuid,
  machine_id uuid,
  head_sha text NOT NULL CONSTRAINT crew_bug_finding_runs_head_check CHECK (head_sha ~ '^[0-9a-f]{40}$'),
  pr_url text NOT NULL CONSTRAINT crew_bug_finding_runs_pr_check CHECK (length(pr_url) BETWEEN 1 AND 500),
  state text NOT NULL CONSTRAINT crew_bug_finding_runs_state_check
    CHECK (state IN ('requested','queued','running','succeeded','failed','timeout','cancelled','skipped')),
  verdict text CONSTRAINT crew_bug_finding_runs_verdict_check CHECK (verdict IN ('APPROVE','APPROVE WITH CONDITIONS','BLOCK')),
  lanes_done integer CONSTRAINT crew_bug_finding_runs_lanes_done_check CHECK (lanes_done >= 0),
  lanes_total integer CONSTRAINT crew_bug_finding_runs_lanes_total_check CHECK (lanes_total >= 0),
  findings jsonb CONSTRAINT crew_bug_finding_runs_findings_check CHECK (findings IS NULL OR jsonb_typeof(findings) = 'array'),
  feedback_text text CONSTRAINT crew_bug_finding_runs_feedback_check CHECK (length(feedback_text) <= 20000),
  report_document_key text CONSTRAINT crew_bug_finding_runs_report_check CHECK (report_document_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  cost_usd numeric(10,4),
  error text CONSTRAINT crew_bug_finding_runs_error_check CHECK (length(error) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crew_bug_finding_runs_run_key UNIQUE (issue_id, approval_round, head_sha, run)
);
CREATE INDEX crew_bug_finding_runs_issue_idx ON plugin_crew_core_0433ea20b6.crew_bug_finding_runs (issue_id, created_at DESC);
CREATE INDEX crew_bug_finding_runs_open_idx ON plugin_crew_core_0433ea20b6.crew_bug_finding_runs (state, created_at)
  WHERE state IN ('requested','queued','running');
CREATE TABLE plugin_crew_core_0433ea20b6.crew_bug_finding_rounds (
  company_id uuid NOT NULL,
  issue_id uuid NOT NULL,
  round integer NOT NULL CONSTRAINT crew_bug_finding_rounds_round_check CHECK (round >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crew_bug_finding_rounds_pkey PRIMARY KEY (company_id, issue_id)
);
ALTER TABLE plugin_crew_core_0433ea20b6.crew_machine_jobs DROP CONSTRAINT crew_machine_jobs_kind_check;
ALTER TABLE plugin_crew_core_0433ea20b6.crew_machine_jobs ADD CONSTRAINT crew_machine_jobs_kind_check CHECK (kind IN ('inspect-folder','prepare-checkouts','agent-workspace','skill-sync','check','remove-checkouts','skill-remove','runtimes-setup','ensure-project','bug-finding-review'));
