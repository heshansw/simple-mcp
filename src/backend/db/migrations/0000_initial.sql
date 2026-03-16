-- Create connections table
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  integration_type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  auth_method TEXT NOT NULL,
  status TEXT DEFAULT 'disconnected' NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Create credentials table
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  encrypted_data TEXT NOT NULL,
  iv TEXT NOT NULL,
  algorithm TEXT DEFAULT 'aes-256-cbc' NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES connections(id)
);

-- Create agent_configs table
CREATE TABLE IF NOT EXISTS agent_configs (
  id TEXT PRIMARY KEY,
  agent_id TEXT UNIQUE NOT NULL,
  enabled INTEGER DEFAULT 0 NOT NULL,
  parameter_overrides TEXT DEFAULT '{}' NOT NULL,
  linked_connection_ids TEXT DEFAULT '[]' NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Create server_settings table
CREATE TABLE IF NOT EXISTS server_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Create sync_metadata table
CREATE TABLE IF NOT EXISTS sync_metadata (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  metadata_type TEXT NOT NULL,
  data TEXT NOT NULL,
  last_sync_at TEXT NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES connections(id)
);

-- Create audit_log table
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_credentials_connection_id ON credentials(connection_id);
CREATE INDEX IF NOT EXISTS idx_agent_configs_agent_id ON agent_configs(agent_id);
CREATE INDEX IF NOT EXISTS idx_sync_metadata_connection_id ON sync_metadata(connection_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
