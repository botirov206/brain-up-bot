-- Member suggestions, and a one-shot "waiting for their next message" flag.
ALTER TABLE users
  ADD COLUMN pending text CHECK (pending IS NULL OR pending = 'feedback');

CREATE TABLE feedback (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX feedback_created_idx ON feedback (created_at DESC);
