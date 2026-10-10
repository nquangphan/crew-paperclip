CREATE TABLE plugin_crew_core_0433ea20b6.crew_runtime_switches (
  company_id uuid NOT NULL,
  machine_id uuid NOT NULL,
  runtime text NOT NULL CHECK (runtime IN ('claude_local','codex_local','opencode_local')),
  enabled boolean NOT NULL,
  updated_by_user_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, machine_id, runtime)
);
CREATE TABLE plugin_crew_core_0433ea20b6.crew_runtime_decisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid NOT NULL,
  issue_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'executor' CHECK (role IN ('executor','reviewer')),
  kind text NOT NULL CHECK (kind IN ('select','fallback','fallback_refused')),
  run_id uuid,
  machine_id uuid,
  from_agent_id uuid,
  to_agent_id uuid,
  from_runtime text,
  to_runtime text,
  model text,
  complexity text,
  trigger text CHECK (trigger IS NULL OR trigger IN ('quota','auth','unavailable','switch_off','other')),
  reason text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crew_runtime_decisions_run_kind_uq ON plugin_crew_core_0433ea20b6.crew_runtime_decisions (run_id, kind) WHERE run_id IS NOT NULL;
CREATE UNIQUE INDEX crew_runtime_decisions_select_uq ON plugin_crew_core_0433ea20b6.crew_runtime_decisions (issue_id, role) WHERE kind = 'select';
CREATE INDEX crew_runtime_decisions_issue_idx ON plugin_crew_core_0433ea20b6.crew_runtime_decisions (company_id, issue_id, decided_at);
CREATE TABLE plugin_crew_core_0433ea20b6.crew_runtime_waits (
  run_id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  issue_id uuid,
  agent_id uuid NOT NULL,
  machine_id uuid,
  runtime text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  handled_at timestamptz
);
CREATE INDEX crew_runtime_waits_open_idx ON plugin_crew_core_0433ea20b6.crew_runtime_waits (company_id, first_seen_at) WHERE handled_at IS NULL;
ALTER TABLE plugin_crew_core_0433ea20b6.crew_project_roles
  ADD COLUMN codex_executor_agent_id uuid,
  ADD COLUMN opencode_executor_agent_id uuid,
  ADD COLUMN codex_reviewer_agent_id uuid;
ALTER TABLE plugin_crew_core_0433ea20b6.crew_machine_jobs DROP CONSTRAINT crew_machine_jobs_kind_check;
ALTER TABLE plugin_crew_core_0433ea20b6.crew_machine_jobs ADD CONSTRAINT crew_machine_jobs_kind_check CHECK (kind IN ('inspect-folder','prepare-checkouts','agent-workspace','skill-sync','check','remove-checkouts','skill-remove','runtimes-setup'));
