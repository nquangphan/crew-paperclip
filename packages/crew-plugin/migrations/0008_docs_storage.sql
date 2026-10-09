CREATE TABLE plugin_crew_core_0433ea20b6.docs_blobs (
  sha256 text PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer NOT NULL CHECK (byte_size >= 0),
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE plugin_crew_core_0433ea20b6.docs_snapshot_pages (
  snapshot_id uuid NOT NULL REFERENCES plugin_crew_core_0433ea20b6.docs_snapshots(id) ON DELETE CASCADE,
  path text NOT NULL,
  title text NOT NULL,
  parent_path text,
  sha256 text NOT NULL REFERENCES plugin_crew_core_0433ea20b6.docs_blobs(sha256),
  PRIMARY KEY (snapshot_id, path)
);
CREATE INDEX docs_snapshot_pages_sha256 ON plugin_crew_core_0433ea20b6.docs_snapshot_pages (sha256);
ALTER TABLE plugin_crew_core_0433ea20b6.docs_snapshots ADD COLUMN completed_at timestamptz;
ALTER TABLE plugin_crew_core_0433ea20b6.docs_snapshots ADD COLUMN content_key text;
ALTER TABLE plugin_crew_core_0433ea20b6.docs_snapshots ADD COLUMN format integer NOT NULL DEFAULT 1;
ALTER TABLE plugin_crew_core_0433ea20b6.docs_snapshots ADD COLUMN manifest_state text NOT NULL DEFAULT 'not_sent' CHECK (manifest_state IN ('not_sent', 'absent', 'ok', 'invalid', 'dropped'));
ALTER TABLE plugin_crew_core_0433ea20b6.docs_snapshots ADD COLUMN manifest_sha256 text REFERENCES plugin_crew_core_0433ea20b6.docs_blobs(sha256);
ALTER TABLE plugin_crew_core_0433ea20b6.docs_snapshots ADD COLUMN manifest_errors jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE plugin_crew_core_0433ea20b6.docs_snapshots ADD COLUMN commits_truncated boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX docs_snapshots_done_key ON plugin_crew_core_0433ea20b6.docs_snapshots (company_id, project_id, commit, content_key) WHERE completed_at IS NOT NULL;
CREATE INDEX docs_snapshots_project_done ON plugin_crew_core_0433ea20b6.docs_snapshots (company_id, project_id, completed_at);
CREATE TABLE plugin_crew_core_0433ea20b6.docs_commits (
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  sha text NOT NULL CHECK (sha ~ '^[0-9a-f]{40}$'),
  is_merge boolean NOT NULL,
  first_snapshot_id uuid REFERENCES plugin_crew_core_0433ea20b6.docs_snapshots(id) ON DELETE SET NULL,
  PRIMARY KEY (company_id, project_id, sha)
);
CREATE TABLE plugin_crew_core_0433ea20b6.docs_commit_files (
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  sha text NOT NULL,
  path text NOT NULL,
  PRIMARY KEY (company_id, project_id, sha, path)
);
CREATE INDEX docs_commit_files_path ON plugin_crew_core_0433ea20b6.docs_commit_files (company_id, project_id, path);
ALTER TABLE plugin_crew_core_0433ea20b6.crew_attachment_audit ADD COLUMN byte_size bigint;
INSERT INTO plugin_crew_core_0433ea20b6.docs_blobs (sha256, byte_size, text) SELECT DISTINCT ON (h) h, octet_length(p.text), p.text FROM (SELECT encode(sha256(convert_to(text, 'UTF8')), 'hex') AS h, text FROM plugin_crew_core_0433ea20b6.docs_pages) p ORDER BY h ON CONFLICT (sha256) DO NOTHING;
INSERT INTO plugin_crew_core_0433ea20b6.docs_snapshot_pages (snapshot_id, path, title, parent_path, sha256) SELECT snapshot_id, path, title, parent_path, encode(sha256(convert_to(text, 'UTF8')), 'hex') FROM plugin_crew_core_0433ea20b6.docs_pages ON CONFLICT DO NOTHING;
UPDATE plugin_crew_core_0433ea20b6.docs_snapshots SET completed_at = received_at, content_key = 'legacy:' || id::text WHERE id IN (SELECT snapshot_id FROM plugin_crew_core_0433ea20b6.docs_current);
