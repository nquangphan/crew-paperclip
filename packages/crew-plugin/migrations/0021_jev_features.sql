ALTER TABLE plugin_crew_core_0433ea20b6.crew_jev_settings ADD COLUMN features jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE plugin_crew_core_0433ea20b6.crew_jev_judgments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid NOT NULL,
  feature text NOT NULL CHECK (feature IN ('complexity', 'approval_note', 'request_type', 'inbox_attention')),
  issue_id uuid,
  mode text NOT NULL CHECK (mode IN ('shadow', 'on')),
  question_hash text NOT NULL,
  input_excerpt text,
  jev_label text,
  confidence real,
  escalated boolean NOT NULL DEFAULT false,
  error_code text,
  latency_ms integer,
  baseline text,
  mismatch boolean,
  shown boolean NOT NULL DEFAULT false,
  owner_outcome text,
  created_by_user_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crew_jev_judgments_feature_idx ON plugin_crew_core_0433ea20b6.crew_jev_judgments (company_id, feature, id DESC);
CREATE INDEX crew_jev_judgments_company_idx ON plugin_crew_core_0433ea20b6.crew_jev_judgments (company_id, id DESC);
CREATE INDEX crew_jev_judgments_issue_idx ON plugin_crew_core_0433ea20b6.crew_jev_judgments (company_id, issue_id, feature) WHERE issue_id IS NOT NULL;
CREATE INDEX crew_jev_judgments_created_idx ON plugin_crew_core_0433ea20b6.crew_jev_judgments (created_at);
