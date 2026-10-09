CREATE TABLE plugin_crew_core_0433ea20b6.crew_project_roles (
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  assistant_agent_id uuid NOT NULL,
  executor_agent_ids uuid[] NOT NULL,
  reviewer_agent_id uuid NOT NULL,
  integrator_agent_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id text NOT NULL,
  PRIMARY KEY (company_id, project_id),
  CHECK (reviewer_agent_id <> integrator_agent_id),
  CHECK (cardinality(executor_agent_ids) BETWEEN 1 AND 2)
);
CREATE INDEX crew_project_roles_company_idx ON plugin_crew_core_0433ea20b6.crew_project_roles (company_id);
