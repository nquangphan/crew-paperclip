ALTER TABLE plugin_crew_core_0433ea20b6.crew_contributions
  ADD COLUMN submitted_department text
  CONSTRAINT crew_contributions_submitted_department_ck CHECK (submitted_department IN ('marketing','qc'));
UPDATE plugin_crew_core_0433ea20b6.crew_contributions c SET submitted_department = d.department
  FROM plugin_crew_core_0433ea20b6.crew_contributors d
  WHERE d.company_id = c.company_id AND d.user_id = c.author_user_id;
ALTER TABLE plugin_crew_core_0433ea20b6.crew_contributions DROP CONSTRAINT crew_contributions_kind_check;
ALTER TABLE plugin_crew_core_0433ea20b6.crew_contributions DROP CONSTRAINT crew_contributions_shape_ck;
ALTER TABLE plugin_crew_core_0433ea20b6.crew_contributions DROP CONSTRAINT crew_contributions_result_ck;
ALTER TABLE plugin_crew_core_0433ea20b6.crew_contributions
  ADD CONSTRAINT crew_contributions_kind_check CHECK (kind IN ('issue','comment','reopen'));
ALTER TABLE plugin_crew_core_0433ea20b6.crew_contributions
  ADD CONSTRAINT crew_contributions_shape_ck CHECK (
    (kind = 'issue' AND project_id IS NOT NULL AND title IS NOT NULL AND target_issue_id IS NULL)
    OR (kind IN ('comment','reopen') AND target_issue_id IS NOT NULL AND body IS NOT NULL AND project_id IS NULL AND title IS NULL));
ALTER TABLE plugin_crew_core_0433ea20b6.crew_contributions
  ADD CONSTRAINT crew_contributions_result_ck CHECK (
    status <> 'approved'
    OR (kind = 'issue' AND result_issue_id IS NOT NULL)
    OR (kind IN ('comment','reopen') AND result_comment_id IS NOT NULL));
CREATE INDEX crew_contributions_reopen_target_idx ON plugin_crew_core_0433ea20b6.crew_contributions (target_issue_id)
  WHERE kind = 'reopen';
CREATE UNIQUE INDEX crew_contributions_reopen_open_uq ON plugin_crew_core_0433ea20b6.crew_contributions (target_issue_id)
  WHERE kind = 'reopen' AND status IN ('pending','approving');

CREATE TABLE plugin_crew_core_0433ea20b6.crew_qc_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  issue_id uuid NOT NULL,
  qc_user_id text NOT NULL,
  source_contribution_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'awaiting'
    CONSTRAINT crew_qc_rounds_status_ck CHECK (status IN ('awaiting','verified','reopened')),
  started_at timestamptz NOT NULL DEFAULT now(),
  verified_by_user_id text,
  verified_at timestamptz,
  ended_at timestamptz,
  CONSTRAINT crew_qc_rounds_verified_ck CHECK (
    status <> 'verified' OR (verified_by_user_id IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE UNIQUE INDEX crew_qc_rounds_open_uq ON plugin_crew_core_0433ea20b6.crew_qc_rounds (issue_id) WHERE ended_at IS NULL;
CREATE INDEX crew_qc_rounds_company_open_idx ON plugin_crew_core_0433ea20b6.crew_qc_rounds (company_id, qc_user_id)
  WHERE ended_at IS NULL;
