CREATE TABLE plugin_crew_core_0433ea20b6.crew_setup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('add-project','add-agent')),
  project_key text NOT NULL,
  project_id uuid,
  machine_id uuid NOT NULL,
  input jsonb NOT NULL,
  steps jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','failed','done')),
  running_step text,
  running_since timestamptz,
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crew_setup_runs_active_key_idx ON plugin_crew_core_0433ea20b6.crew_setup_runs (company_id, project_key, kind) WHERE status <> 'done' AND kind = 'add-project';
