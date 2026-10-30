-- Votes carry a salted hash of the voter's address (IPv6 cut to /64), so one address casts at most
-- a handful of votes per tape whatever viewer ids it invents. Rows from before this migration have NULL.
ALTER TABLE votes ADD COLUMN ip_hash TEXT;

CREATE INDEX IF NOT EXISTS votes_item_ip ON votes (item_id, ip_hash);
