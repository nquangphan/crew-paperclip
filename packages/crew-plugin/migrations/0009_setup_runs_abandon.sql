ALTER TABLE plugin_crew_core_0433ea20b6.crew_setup_runs ALTER COLUMN project_key DROP NOT NULL;
ALTER TABLE plugin_crew_core_0433ea20b6.crew_setup_runs DROP CONSTRAINT crew_setup_runs_status_check;
ALTER TABLE plugin_crew_core_0433ea20b6.crew_setup_runs ADD CONSTRAINT crew_setup_runs_status_check CHECK (status IN ('running','failed','done','abandoned'));
ALTER TABLE plugin_crew_core_0433ea20b6.crew_setup_runs ADD CONSTRAINT crew_setup_runs_key_check CHECK (project_key IS NOT NULL OR status = 'abandoned');
ALTER TABLE plugin_crew_core_0433ea20b6.crew_setup_runs ADD COLUMN running_token uuid;
