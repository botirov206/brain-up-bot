-- One wake card per day: green, orange, red, or yellow.
ALTER TABLE days ADD COLUMN wake_card text;

ALTER TABLE days DROP CONSTRAINT IF EXISTS days_wake_card_check;
ALTER TABLE days ADD CONSTRAINT days_wake_card_check CHECK (
  wake_card IS NULL OR wake_card IN ('green', 'orange', 'red', 'yellow')
);
