-- REC submissions from viewers. The daily librarian routine vets pending rows,
-- opens a GitHub pull request for accepted ones, and records pr_url + status.
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('suomi', 'international')),
  year INTEGER,
  note TEXT,
  why TEXT,
  signals TEXT,
  submitter TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  pr_url TEXT,
  review_note TEXT,
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS submissions_status_time ON submissions (status, created_at);
CREATE INDEX IF NOT EXISTS submissions_ip_time ON submissions (ip_hash, created_at);
