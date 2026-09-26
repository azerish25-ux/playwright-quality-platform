CREATE TABLE workspaces (id text PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (id text PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE memberships (workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE, user_id text REFERENCES users(id) ON DELETE CASCADE, role text NOT NULL CHECK (role IN ('owner','editor','viewer')), PRIMARY KEY(workspace_id,user_id));
CREATE TABLE projects (id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE tasks (id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title text NOT NULL, status text NOT NULL CHECK(status IN ('todo','doing','done')), due_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE forgeqa_test_tenants (id text PRIMARY KEY, owner_namespace text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX tasks_project_status ON tasks(project_id,status);
