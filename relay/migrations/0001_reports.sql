CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  details TEXT NOT NULL,
  tool TEXT,
  error_code TEXT,
  gateway_version TEXT NOT NULL,
  instance TEXT NOT NULL,
  ip_hash TEXT NOT NULL
);

CREATE INDEX reports_instance_time ON reports (instance, received_at);
CREATE INDEX reports_ip_time ON reports (ip_hash, received_at);
CREATE INDEX reports_time ON reports (received_at);
