ALTER TABLE plugin_crew_core_0433ea20b6.crew_contributors
  ADD COLUMN department text NOT NULL DEFAULT 'marketing'
  CONSTRAINT crew_contributors_department_ck CHECK (department IN ('marketing','qc'));
