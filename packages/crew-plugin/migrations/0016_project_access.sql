CREATE TABLE plugin_crew_core_0433ea20b6.crew_project_access (
  company_id uuid NOT NULL,
  user_id text NOT NULL,
  project_id uuid NOT NULL,
  granted_by_user_id text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id, project_id)
);
CREATE INDEX crew_project_access_project_idx ON plugin_crew_core_0433ea20b6.crew_project_access (company_id, project_id);
