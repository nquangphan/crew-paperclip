CREATE TABLE plugin_crew_core_0433ea20b6.crew_jev_settings (
  company_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  gate_mode text NOT NULL DEFAULT 'shadow' CHECK (gate_mode IN ('shadow', 'enforce')),
  model text NOT NULL DEFAULT 'typesafe/jev-1.14',
  threshold real NOT NULL DEFAULT 0.5 CHECK (threshold BETWEEN 0.3 AND 0.95),
  timeout_ms integer NOT NULL DEFAULT 2500 CHECK (timeout_ms BETWEEN 500 AND 3000),
  server_shadow boolean NOT NULL DEFAULT false,
  key_secret_id uuid,
  key_fingerprint text,
  version integer NOT NULL DEFAULT 1,
  shadow_cursor timestamptz,
  updated_by_user_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE plugin_crew_core_0433ea20b6.crew_jev_machines (
  company_id uuid NOT NULL,
  machine_id uuid NOT NULL,
  applied_version integer,
  key_fingerprint text,
  last_pull_at timestamptz,
  last_events_at timestamptz,
  PRIMARY KEY (company_id, machine_id)
);
CREATE TABLE plugin_crew_core_0433ea20b6.crew_jev_gate_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid NOT NULL,
  machine_id uuid NOT NULL,
  event_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  run_id uuid,
  agent_id uuid,
  mode text NOT NULL,
  category text,
  verdict text NOT NULL CHECK (verdict IN ('allow', 'deny', 'escalate', 'error')),
  applied text NOT NULL CHECK (applied IN ('allow', 'deny')),
  blocking boolean NOT NULL,
  confidence real,
  reason text,
  error_code text,
  latency_ms integer,
  model text,
  command text NOT NULL,
  cwd text,
  owner_label text CHECK (owner_label IN ('correct', 'wrong')),
  labeled_by_user_id text,
  labeled_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, event_id)
);
CREATE INDEX crew_jev_gate_events_time_idx ON plugin_crew_core_0433ea20b6.crew_jev_gate_events (company_id, occurred_at);
CREATE INDEX crew_jev_gate_events_verdict_idx ON plugin_crew_core_0433ea20b6.crew_jev_gate_events (company_id, verdict, occurred_at);
CREATE TABLE plugin_crew_core_0433ea20b6.crew_jev_shadow (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('liveness', 'runtime')),
  run_id uuid NOT NULL,
  regex_label text NOT NULL,
  jev_label text,
  confidence real,
  escalated boolean,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'error')),
  error_code text,
  latency_ms integer,
  input_excerpt text,
  created_at timestamptz NOT NULL DEFAULT now(),
  evaluated_at timestamptz,
  UNIQUE (run_id, kind)
);
CREATE INDEX crew_jev_shadow_status_idx ON plugin_crew_core_0433ea20b6.crew_jev_shadow (company_id, status);
CREATE INDEX crew_jev_shadow_time_idx ON plugin_crew_core_0433ea20b6.crew_jev_shadow (company_id, created_at);
