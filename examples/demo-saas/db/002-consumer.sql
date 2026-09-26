CREATE TABLE teamboard_test_runs (namespace text PRIMARY KEY, cleanup_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE users ADD COLUMN test_namespace text;
ALTER TABLE workspaces ADD COLUMN test_namespace text;
ALTER TABLE workspaces ADD COLUMN attachments_enabled boolean NOT NULL DEFAULT false;
CREATE INDEX users_test_namespace ON users(test_namespace);
CREATE INDEX workspaces_test_namespace ON workspaces(test_namespace);
CREATE TABLE teamboard_sessions (token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL);
CREATE INDEX teamboard_sessions_expiry ON teamboard_sessions(expires_at);
CREATE TABLE teamboard_attachments (id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, filename text NOT NULL, content bytea NOT NULL CHECK(octet_length(content)<=65536));
