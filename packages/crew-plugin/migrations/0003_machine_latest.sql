ALTER TABLE plugin_crew_core_0433ea20b6.machine_reports ALTER COLUMN load1 DROP NOT NULL;
ALTER TABLE plugin_crew_core_0433ea20b6.machine_reports ALTER COLUMN cpu_count DROP NOT NULL;
ALTER TABLE plugin_crew_core_0433ea20b6.machine_reports ALTER COLUMN mem_free_pct DROP NOT NULL;
CREATE TABLE plugin_crew_core_0433ea20b6.machine_latest (
  company_id uuid NOT NULL,
  machine_id uuid NOT NULL,
  hostname text NOT NULL,
  received_at timestamptz NOT NULL,
  sent_at timestamptz NOT NULL,
  load1 double precision,
  cpu_count integer,
  mem_free_pct double precision,
  report jsonb NOT NULL,
  PRIMARY KEY (company_id, machine_id)
);
INSERT INTO plugin_crew_core_0433ea20b6.machine_latest (company_id,machine_id,hostname,received_at,sent_at,load1,cpu_count,mem_free_pct,report)
SELECT DISTINCT ON (company_id,machine_id) company_id,machine_id,hostname,received_at,sent_at,load1,cpu_count,mem_free_pct,report
FROM plugin_crew_core_0433ea20b6.machine_reports ORDER BY company_id,machine_id,received_at DESC,id DESC;
CREATE INDEX docs_snapshots_stale_idx ON plugin_crew_core_0433ea20b6.docs_snapshots (company_id, project_id, received_at);
