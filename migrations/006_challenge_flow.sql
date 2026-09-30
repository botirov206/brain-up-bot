-- Additive challenge flow: membership, waitlist, personal topics, plans, accountability.
-- Dates stay application-supplied. Do not use CURRENT_DATE.

ALTER TABLE users ADD COLUMN blocked_at timestamptz;
ALTER TABLE users ADD COLUMN blocked_by bigint;
ALTER TABLE users ADD COLUMN block_reason text;
ALTER TABLE users ADD COLUMN private_reachable boolean;
ALTER TABLE users ADD COLUMN pending_payload jsonb;
ALTER TABLE users ADD COLUMN pending_expires_at timestamptz;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pending_check;
ALTER TABLE users ADD CONSTRAINT users_pending_check CHECK (
  pending IS NULL OR pending IN (
    'feedback', 'explain', 'todo', 'judgment', 'announcement', 'note', 'exercise'
  )
);

CREATE TABLE forum_memberships (
  forum_chat_id bigint NOT NULL,
  telegram_id bigint NOT NULL,
  telegram_status text NOT NULL,
  is_member boolean NOT NULL,
  verified_at timestamptz NOT NULL,
  admitted_at timestamptz,
  PRIMARY KEY (forum_chat_id, telegram_id)
);

CREATE INDEX forum_memberships_lookup_idx
  ON forum_memberships (forum_chat_id, is_member, telegram_id);

CREATE TABLE waitlist (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users (id),
  forum_chat_id bigint NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'withdrawn', 'admitted')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CHECK (
    (state = 'active' AND closed_at IS NULL)
    OR (state <> 'active' AND closed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX waitlist_one_active_idx ON waitlist (user_id) WHERE state = 'active';
CREATE INDEX waitlist_forum_active_idx ON waitlist (forum_chat_id, joined_at) WHERE state = 'active';

ALTER TABLE days ADD COLUMN forum_chat_id bigint;
ALTER TABLE days ADD COLUMN assignment_at timestamptz;
ALTER TABLE days ADD COLUMN forum_posted_at timestamptz;
ALTER TABLE days ADD COLUMN forum_delivery_status text
  CHECK (forum_delivery_status IS NULL OR forum_delivery_status IN ('pending', 'published', 'failed', 'uncertain'));
ALTER TABLE days ADD COLUMN private_delivery_status text
  CHECK (private_delivery_status IS NULL OR private_delivery_status IN ('pending', 'sent', 'failed', 'skipped', 'uncertain'));
ALTER TABLE days ADD COLUMN response_source text
  CHECK (response_source IS NULL OR response_source IN ('private', 'forum'));
ALTER TABLE days ADD COLUMN publication_status text
  CHECK (publication_status IS NULL OR publication_status IN ('pending', 'published', 'failed', 'original'));
ALTER TABLE days ADD COLUMN publication_error text;
ALTER TABLE days ADD COLUMN response_chat_id bigint;
ALTER TABLE days ADD COLUMN response_message_id bigint;
ALTER TABLE days ADD COLUMN youtube_url text;
ALTER TABLE days ADD COLUMN obligation_snapshot jsonb;

ALTER TABLE days DROP CONSTRAINT IF EXISTS days_reply_kind_check;
ALTER TABLE days ADD CONSTRAINT days_reply_kind_check
  CHECK (reply_kind IS NULL OR reply_kind IN ('voice', 'video_note', 'audio', 'video', 'video_file', 'youtube'));

CREATE INDEX days_forum_date_idx ON days (forum_chat_id, date);

CREATE TABLE daily_plans (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  day_id integer NOT NULL UNIQUE REFERENCES days (id),
  state text NOT NULL CHECK (state IN ('draft', 'published')),
  original_input text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  published_at timestamptz,
  note text,
  private_chat_id bigint,
  private_message_id bigint,
  forum_chat_id bigint,
  forum_topic_id bigint,
  forum_message_id bigint,
  CHECK (
    (state = 'draft' AND published_at IS NULL)
    OR (state = 'published' AND published_at IS NOT NULL)
  )
);

CREATE TABLE daily_tasks (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id integer NOT NULL REFERENCES daily_plans (id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 250),
  start_time text CHECK (start_time IS NULL OR start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time text CHECK (end_time IS NULL OR end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  UNIQUE (plan_id, position),
  CHECK (
    (completed = false AND completed_at IS NULL)
    OR (completed = true AND completed_at IS NOT NULL)
  )
);

CREATE INDEX daily_tasks_plan_idx ON daily_tasks (plan_id, position);

CREATE OR REPLACE FUNCTION daily_plans_require_task() RETURNS trigger AS $$
BEGIN
  IF NEW.state = 'published' AND NOT EXISTS (SELECT 1 FROM daily_tasks WHERE plan_id = NEW.id) THEN
    RAISE EXCEPTION 'published plan requires a task';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS daily_plans_require_task_trg ON daily_plans;
CREATE TRIGGER daily_plans_require_task_trg
  BEFORE UPDATE OF state ON daily_plans
  FOR EACH ROW
  EXECUTE FUNCTION daily_plans_require_task();

ALTER TABLE day_posts ADD COLUMN chat_id bigint;
ALTER TABLE day_posts ADD COLUMN topic_id bigint;
ALTER TABLE day_posts ADD COLUMN part_index integer NOT NULL DEFAULT 0;
ALTER TABLE day_posts DROP CONSTRAINT day_posts_pkey;
ALTER TABLE day_posts ADD PRIMARY KEY (date, kind, part_index);

CREATE TABLE accountability_cases (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  day_id integer NOT NULL REFERENCES days (id),
  user_id integer NOT NULL REFERENCES users (id),
  requirement text NOT NULL CHECK (requirement IN ('wake', 'plan', 'topic_response')),
  deadline_at timestamptz NOT NULL,
  reminded_at timestamptz,
  grace_expires_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('open', 'resolved', 'excused', 'judged')),
  late boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (day_id, requirement),
  CHECK (grace_expires_at >= deadline_at)
);

CREATE INDEX accountability_due_idx ON accountability_cases (state, grace_expires_at);

CREATE TABLE judgments (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id integer NOT NULL UNIQUE REFERENCES accountability_cases (id),
  admin_telegram_id bigint NOT NULL,
  body text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('excuse', 'exercise')),
  forum_chat_id bigint,
  forum_topic_id bigint,
  forum_message_id bigint,
  evidence_text text,
  evidence_file_id text,
  evidence_kind text,
  evidence_at timestamptz,
  evidence_by bigint,
  resolution text NOT NULL DEFAULT 'pending' CHECK (resolution IN ('pending', 'resolved')),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE waitlist_announcements (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  body text NOT NULL,
  admin_telegram_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  recipient_count integer NOT NULL,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  CHECK (confirmed_at IS NULL OR cancelled_at IS NULL)
);

CREATE TABLE waitlist_announcement_deliveries (
  announcement_id integer NOT NULL REFERENCES waitlist_announcements (id),
  user_id integer NOT NULL REFERENCES users (id),
  status text NOT NULL CHECK (status IN ('snapshot', 'sent', 'failed')),
  error text,
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE outbound_deliveries (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  logical_key text NOT NULL UNIQUE,
  operation text NOT NULL,
  subject text,
  destination_chat_id bigint,
  destination_topic_id bigint,
  status text NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'uncertain')),
  attempts integer NOT NULL DEFAULT 0,
  retry_at timestamptz,
  message_id bigint,
  last_error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outbound_pending_idx ON outbound_deliveries (status, retry_at, id);

ALTER TABLE settings ADD COLUMN topic_daily_id bigint;
ALTER TABLE settings ADD COLUMN topic_unusual_id bigint;
ALTER TABLE settings ADD COLUMN topic_reminders_id bigint;
ALTER TABLE settings ADD COLUMN topic_exercises_id bigint;
ALTER TABLE settings ADD COLUMN topic_schedule_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE settings ADD COLUMN plan_deadline text NOT NULL DEFAULT '09:00'
  CHECK (plan_deadline ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE settings ADD COLUMN response_deadline text NOT NULL DEFAULT '20:00'
  CHECK (response_deadline ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE settings ADD COLUMN grace_minutes integer NOT NULL DEFAULT 60
  CHECK (grace_minutes BETWEEN 15 AND 180);
ALTER TABLE settings ADD COLUMN bot_forum_status text;

-- Backfill destinations only from the single saved connection. Unknown rows stay null
-- and are left out of automatic cleanup.
UPDATE day_posts AS posts
SET chat_id = settings.group_chat_id::bigint
FROM settings
WHERE settings.id = 1
  AND posts.chat_id IS NULL
  AND settings.group_chat_id ~ '^-?[0-9]+$';

UPDATE days
SET forum_chat_id = settings.group_chat_id::bigint
FROM settings
WHERE settings.id = 1
  AND days.forum_chat_id IS NULL
  AND settings.group_chat_id ~ '^-?[0-9]+$';
