-- Viewer sentiment for the living library.
-- One row per viewer per tape. Plays are one row per viewer per tape per UTC day.
-- Scheduling reads rows with created_at before the UTC midnight of the day on air.

CREATE TABLE IF NOT EXISTS votes (
  viewer_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  vote INTEGER NOT NULL CHECK (vote IN (1, -1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (viewer_id, item_id)
);

CREATE INDEX IF NOT EXISTS votes_channel_time ON votes (channel, created_at);

CREATE TABLE IF NOT EXISTS impressions (
  viewer_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (viewer_id, item_id, day)
);

CREATE INDEX IF NOT EXISTS impressions_channel_time ON impressions (channel, created_at);
