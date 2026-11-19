-- Per-user "added" flag for the Workspace services list. NULL on existing rows means "added
-- exactly when selected", so every service a user already had switched on stays in their list
-- and nothing needs backfilling. With DB_SYNCHRONIZE=true TypeORM adds the column itself.
ALTER TABLE user_server_selections ADD COLUMN IF NOT EXISTS "added" boolean;
