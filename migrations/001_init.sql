-- Brain-Up initial schema.
-- "Today" is a calendar date in Asia/Tashkent, computed by the app and passed
-- in as a date. Do not use CURRENT_DATE here: the database server may be UTC.
-- schema_migrations is created by the runner in src/db.ts, not by this file.

CREATE TABLE users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_id bigint NOT NULL UNIQUE,
  name text NOT NULL,
  username text,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE topics (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  text text NOT NULL,
  last_used_on date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE days (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date date NOT NULL,
  wake_up_at timestamptz,
  topic_id integer REFERENCES topics (id) ON DELETE SET NULL,
  topic_sent_at timestamptz,
  reply_file_id text,
  reply_kind text CHECK (reply_kind IN ('voice', 'video_note', 'audio')),
  reply_at timestamptz,
  UNIQUE (user_id, date)
);

CREATE INDEX days_date_idx ON days (date);

CREATE TABLE settings (
  id integer PRIMARY KEY CHECK (id = 1),
  wake_time text NOT NULL DEFAULT '04:00' CHECK (wake_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  topic_time text NOT NULL DEFAULT '07:00' CHECK (topic_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  report_time text NOT NULL DEFAULT '21:00' CHECK (report_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);

INSERT INTO settings (id) VALUES (1);

-- One tracked group message per day (the "N / M uyg'ondi" line).
CREATE TABLE day_posts (
  date date NOT NULL,
  kind text NOT NULL,
  message_id bigint NOT NULL,
  PRIMARY KEY (date, kind)
);
