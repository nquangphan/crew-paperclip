CREATE TABLE plugin_crew_core_0433ea20b6.docs_snapshots (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  machine_id text NOT NULL,
  repo text NOT NULL,
  commit text NOT NULL,
  audit_state text NOT NULL,
  check_exit integer NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  dropped jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE plugin_crew_core_0433ea20b6.docs_current (
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES plugin_crew_core_0433ea20b6.docs_snapshots(id),
  PRIMARY KEY (company_id, project_id)
);
CREATE TABLE plugin_crew_core_0433ea20b6.docs_pages (
  snapshot_id uuid NOT NULL REFERENCES plugin_crew_core_0433ea20b6.docs_snapshots(id) ON DELETE CASCADE,
  path text NOT NULL,
  title text NOT NULL,
  parent_path text,
  text text NOT NULL,
  sha256 text NOT NULL,
  PRIMARY KEY (snapshot_id, path)
);
CREATE TABLE plugin_crew_core_0433ea20b6.docs_links (
  snapshot_id uuid NOT NULL REFERENCES plugin_crew_core_0433ea20b6.docs_snapshots(id) ON DELETE CASCADE,
  from_path text NOT NULL,
  occurrence integer NOT NULL,
  original_href text NOT NULL,
  to_path text,
  fragment text,
  status text NOT NULL,
  PRIMARY KEY (snapshot_id, from_path, occurrence)
);
CREATE INDEX docs_pages_search ON plugin_crew_core_0433ea20b6.docs_pages (snapshot_id);
