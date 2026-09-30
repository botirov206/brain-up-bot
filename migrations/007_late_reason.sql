-- Late check-in reasons wait for an admin decision.
ALTER TABLE days ADD COLUMN explanation_status text;

ALTER TABLE days DROP CONSTRAINT IF EXISTS days_explanation_status_check;
ALTER TABLE days ADD CONSTRAINT days_explanation_status_check CHECK (
  explanation_status IS NULL OR explanation_status IN ('pending', 'excused', 'tasked')
);
