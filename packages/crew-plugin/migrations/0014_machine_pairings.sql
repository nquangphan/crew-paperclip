CREATE TABLE plugin_crew_core_0433ea20b6.machine_pairings (
  company_id uuid NOT NULL,
  machine_id uuid NOT NULL,
  hostname text NOT NULL,
  environment_id uuid NOT NULL,
  tailscale_ip text NOT NULL,
  port integer NOT NULL,
  host_key_fingerprint text NOT NULL,
  key_nonce text NOT NULL,
  paired_by_user_id text NOT NULL,
  paired_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_user_id text,
  PRIMARY KEY (company_id, machine_id)
);
