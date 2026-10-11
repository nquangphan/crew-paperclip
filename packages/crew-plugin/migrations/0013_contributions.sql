CREATE TABLE plugin_crew_core_0433ea20b6.crew_contributors (
  company_id uuid NOT NULL,
  user_id text NOT NULL,
  granted_by_user_id text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);

CREATE TABLE plugin_crew_core_0433ea20b6.crew_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('issue','comment')),
  author_user_id text NOT NULL,
  project_id uuid,
  target_issue_id uuid,
  title text,
  body text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approving','approved','rejected')),
  decided_by_user_id text,
  approving_at timestamptz,
  decided_at timestamptz,
  result_issue_id uuid,
  result_comment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crew_contributions_shape_ck CHECK (
    (kind = 'issue' AND project_id IS NOT NULL AND title IS NOT NULL AND target_issue_id IS NULL)
    OR (kind = 'comment' AND target_issue_id IS NOT NULL AND body IS NOT NULL AND project_id IS NULL AND title IS NULL)),
  CONSTRAINT crew_contributions_result_ck CHECK (
    status <> 'approved'
    OR (kind = 'issue' AND result_issue_id IS NOT NULL)
    OR (kind = 'comment' AND result_comment_id IS NOT NULL))
);
CREATE INDEX crew_contributions_status_idx ON plugin_crew_core_0433ea20b6.crew_contributions (company_id, status, created_at);
CREATE INDEX crew_contributions_author_idx ON plugin_crew_core_0433ea20b6.crew_contributions (company_id, author_user_id, created_at);
CREATE INDEX crew_contributions_target_idx ON plugin_crew_core_0433ea20b6.crew_contributions (target_issue_id) WHERE kind = 'comment';
