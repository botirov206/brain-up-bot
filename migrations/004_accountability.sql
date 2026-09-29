-- Why someone missed or was late, and the two clocks that define that.
ALTER TABLE days ADD COLUMN explanation text;
ALTER TABLE days ADD COLUMN explanation_at timestamptz;

ALTER TABLE settings
  ADD COLUMN on_time text NOT NULL DEFAULT '06:00'
  CHECK (on_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

ALTER TABLE settings
  ADD COLUMN explain_time text NOT NULL DEFAULT '08:00'
  CHECK (explain_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pending_check;
ALTER TABLE users
  ADD CONSTRAINT users_pending_check
  CHECK (pending IS NULL OR pending IN ('feedback', 'explain'));
