CREATE TABLE plugin_crew_core_0433ea20b6.project_machines (
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  machine_id uuid NOT NULL,
  repo_path text,
  status text NOT NULL CONSTRAINT project_machines_status_check CHECK (status IN ('provisioning','ready','failed')),
  error text CONSTRAINT project_machines_error_check CHECK (error IS NULL OR length(error) <= 300),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_machines_pkey PRIMARY KEY (company_id, project_id, machine_id)
);
CREATE TABLE plugin_crew_core_0433ea20b6.project_repos (
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  origin_url text NOT NULL CONSTRAINT project_repos_origin_check CHECK (length(origin_url) BETWEEN 1 AND 500),
  branch text NOT NULL DEFAULT 'main' CONSTRAINT project_repos_branch_check CHECK (length(branch) BETWEEN 1 AND 100),
  companions jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT project_repos_companions_check CHECK (jsonb_typeof(companions) = 'array'),
  updated_by_user_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_repos_pkey PRIMARY KEY (company_id, project_id)
);
CREATE TABLE plugin_crew_core_0433ea20b6.issue_machine_pins (
  company_id uuid NOT NULL,
  root_issue_id uuid NOT NULL,
  machine_id uuid NOT NULL,
  source text NOT NULL CONSTRAINT issue_machine_pins_source_check CHECK (source IN ('owner','auto')),
  reason jsonb NOT NULL DEFAULT '{}'::jsonb,
  pinned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT issue_machine_pins_pkey PRIMARY KEY (company_id, root_issue_id)
);
CREATE INDEX issue_machine_pins_machine_idx ON plugin_crew_core_0433ea20b6.issue_machine_pins (company_id, machine_id);
ALTER TABLE plugin_crew_core_0433ea20b6.crew_machine_jobs DROP CONSTRAINT crew_machine_jobs_kind_check;
ALTER TABLE plugin_crew_core_0433ea20b6.crew_machine_jobs ADD CONSTRAINT crew_machine_jobs_kind_check CHECK (kind IN ('inspect-folder','prepare-checkouts','agent-workspace','skill-sync','check','remove-checkouts','skill-remove','runtimes-setup','ensure-project'));
