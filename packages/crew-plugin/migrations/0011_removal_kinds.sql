ALTER TABLE plugin_crew_core_0433ea20b6.crew_machine_jobs DROP CONSTRAINT crew_machine_jobs_kind_check;
ALTER TABLE plugin_crew_core_0433ea20b6.crew_machine_jobs ADD CONSTRAINT crew_machine_jobs_kind_check CHECK (kind IN ('inspect-folder','prepare-checkouts','agent-workspace','skill-sync','check','remove-checkouts','skill-remove'));
ALTER TABLE plugin_crew_core_0433ea20b6.crew_setup_runs DROP CONSTRAINT crew_setup_runs_kind_check;
ALTER TABLE plugin_crew_core_0433ea20b6.crew_setup_runs ADD CONSTRAINT crew_setup_runs_kind_check CHECK (kind IN ('add-project','add-agent','remove-project','remove-agent'));
CREATE UNIQUE INDEX crew_setup_runs_active_remove_project_idx ON plugin_crew_core_0433ea20b6.crew_setup_runs (company_id, project_id) WHERE kind = 'remove-project' AND status IN ('running','failed');
CREATE UNIQUE INDEX crew_setup_runs_active_remove_agent_idx ON plugin_crew_core_0433ea20b6.crew_setup_runs (company_id, (input->>'agentId')) WHERE kind = 'remove-agent' AND status IN ('running','failed');
