CREATE TABLE plugin_crew_core_0433ea20b6.crew_machine_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  machine_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('inspect-folder','prepare-checkouts','agent-workspace','skill-sync','check')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','done','failed','cancelled')),
  result jsonb,
  error_code text,
  error_text text CHECK (error_text IS NULL OR length(error_text) <= 300),
  attempts integer NOT NULL DEFAULT 0,
  setup_run_id uuid,
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  lease_until timestamptz,
  finished_at timestamptz
);
CREATE INDEX crew_machine_jobs_queue_idx ON plugin_crew_core_0433ea20b6.crew_machine_jobs (company_id, machine_id, status, created_at);
