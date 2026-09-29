-- New installations start at 05:00; keep any time an admin already chose.
ALTER TABLE settings ALTER COLUMN wake_time SET DEFAULT '05:00';
