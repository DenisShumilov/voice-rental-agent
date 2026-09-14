-- Database schema for the voice equipment rental desk.
-- Invariant: this database is the only source of truth for inventory and
-- bookings. The language model never decides what is stored here.

CREATE TABLE items (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  total_stock INTEGER NOT NULL CHECK (total_stock >= 0)
);

-- A confirmed booking. One row per booking, ever.
-- draft_id is the idempotency key: a draft can produce at most one
-- reservation, enforced by the database rather than by application code.
CREATE TABLE reservations (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL REFERENCES items(id),
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'confirmed',
  source     TEXT NOT NULL,
  draft_id   TEXT UNIQUE,
  created_at TEXT NOT NULL,
  CHECK (start_date <= end_date),
  CHECK (status IN ('confirmed', 'cancelled'))
);

-- The single booking request currently under discussion in a conversation.
-- Every change bumps version and rotates confirmation_token, which is what
-- makes a stale confirmation impossible to redeem.
CREATE TABLE drafts (
  id                 TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL,
  version            INTEGER NOT NULL DEFAULT 1,
  item_id            TEXT,
  quantity           INTEGER,
  start_date         TEXT,
  end_date           TEXT,
  status             TEXT NOT NULL,
  confirmation_token TEXT,
  reservation_id     TEXT,
  updated_at         TEXT NOT NULL,
  CHECK (status IN ('incomplete', 'available', 'unavailable', 'confirmed'))
);

-- Append-only log of everything that happened: speech, tool calls, tool
-- results, barge-ins and latency marks. This is the evidence trail shown
-- on the reviewer page.
CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  ts         TEXT NOT NULL,
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL
);

CREATE INDEX idx_reservations_lookup ON reservations (item_id, status, start_date, end_date);
CREATE INDEX idx_drafts_session ON drafts (session_id);

-- One live draft per conversation, enforced by the database rather than by an
-- application assumption. Without this, two overlapping set_request calls each
-- insert a draft, and the losing row keeps a valid token that no later
-- correction can rotate. The predicate keeps "a confirmed draft is terminal,
-- open a fresh one" working.
CREATE UNIQUE INDEX idx_drafts_live_session ON drafts (session_id) WHERE status <> 'confirmed';
CREATE INDEX idx_events_session ON events (session_id, id);
