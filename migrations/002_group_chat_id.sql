-- Optional until an admin sets it with /group. Supergroup ids look like -100...
ALTER TABLE settings
  ADD COLUMN group_chat_id text
  CHECK (group_chat_id IS NULL OR group_chat_id ~ '^-?[0-9]+$');
