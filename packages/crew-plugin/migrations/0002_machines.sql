CREATE TABLE plugin_crew_core_0433ea20b6.machine_reports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid NOT NULL,
  machine_id uuid NOT NULL,
  hostname text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz NOT NULL,
  load1 double precision NOT NULL,
  cpu_count integer NOT NULL,
  mem_free_pct double precision NOT NULL,
  report jsonb NOT NULL
);
CREATE INDEX machine_reports_company_machine_received_idx ON plugin_crew_core_0433ea20b6.machine_reports (company_id, machine_id, received_at DESC, id DESC);
CREATE INDEX machine_reports_received_idx ON plugin_crew_core_0433ea20b6.machine_reports (received_at);
