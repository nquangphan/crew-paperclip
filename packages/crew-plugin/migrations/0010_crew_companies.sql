CREATE TABLE plugin_crew_core_0433ea20b6.crew_companies (
  company_id uuid PRIMARY KEY,
  name text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now()
);
