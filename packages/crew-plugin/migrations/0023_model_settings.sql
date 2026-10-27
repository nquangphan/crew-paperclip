CREATE TABLE plugin_crew_core_0433ea20b6.crew_model_settings (
  revision integer PRIMARY KEY CONSTRAINT crew_model_settings_revision_check CHECK (revision >= 1),
  settings jsonb NOT NULL CONSTRAINT crew_model_settings_settings_check CHECK (jsonb_typeof(settings) = 'object'),
  change jsonb NOT NULL CONSTRAINT crew_model_settings_change_check CHECK (jsonb_typeof(change) = 'object'),
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
