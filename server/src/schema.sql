-- Ivent Event Check-In System Schema

-- Users table with is_admin flag and registration number.
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  reg_number TEXT,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure reg_number column exists if upgrading from older schema
ALTER TABLE users ADD COLUMN IF NOT EXISTS reg_number TEXT;

-- Clubs table (clubs created via SQL queries or admin panel).
CREATE TABLE IF NOT EXISTS clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Club organizers / members (admins link users to clubs).
CREATE TABLE IF NOT EXISTS club_members (
  club_id UUID REFERENCES clubs(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (club_id, user_id)
);

-- Events table linked to a club.
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID REFERENCES clubs(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  location TEXT,
  event_date TIMESTAMPTZ NOT NULL,
  capacity INT NOT NULL CHECK (capacity > 0),
  registered_count INT NOT NULL DEFAULT 0 CHECK (registered_count <= capacity),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Per-event permissions.
CREATE TABLE IF NOT EXISTS event_organizers (
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);

-- One row per attendee ticket.
CREATE TABLE IF NOT EXISTS registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID,
  user_id UUID,
  totp_secret TEXT NOT NULL,
  checked_in_at TIMESTAMPTZ,
  checked_in_by TEXT,
  checked_in_source TEXT CHECK (checked_in_source IN ('online','offline-sync')),
  client_scan_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_reg_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_reg_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uq_reg_event_user UNIQUE(event_id, user_id)
);

-- Append-only audit trail -- every scan attempt, not just winners.
CREATE TABLE IF NOT EXISTS scan_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID REFERENCES registrations(id),
  station_id TEXT NOT NULL,
  client_scan_id UUID NOT NULL,
  device_timestamp TIMESTAMPTZ NOT NULL,
  server_received_at TIMESTAMPTZ DEFAULT NOW(),
  result TEXT NOT NULL CHECK (result IN
    ('accepted','rejected_duplicate','flagged_conflict','rejected_invalid_totp')),
  UNIQUE(client_scan_id)
);

-- Station bundles for offline cryptographic distribution.
CREATE TABLE IF NOT EXISTS station_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  station_id TEXT NOT NULL,
  ciphertext BYTEA NOT NULL,
  salt BYTEA NOT NULL,
  iv BYTEA NOT NULL,
  auth_tag BYTEA NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Database Performance and Look-up Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_reg_number ON users(LOWER(reg_number)) WHERE reg_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_reg_number_unique ON users(LOWER(reg_number)) WHERE reg_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_club_members_user_id ON club_members(user_id);
CREATE INDEX IF NOT EXISTS idx_club_members_club_id ON club_members(club_id);
CREATE INDEX IF NOT EXISTS idx_events_club_id ON events(club_id);
CREATE INDEX IF NOT EXISTS idx_events_created_by ON events(created_by);
CREATE INDEX IF NOT EXISTS idx_event_organizers_event_id ON event_organizers(event_id);
CREATE INDEX IF NOT EXISTS idx_event_organizers_user_id ON event_organizers(user_id);
CREATE INDEX IF NOT EXISTS idx_registrations_event_id ON registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_registrations_user_id ON registrations(user_id);
CREATE INDEX IF NOT EXISTS idx_registrations_checked_in_at ON registrations(checked_in_at);
CREATE INDEX IF NOT EXISTS idx_scan_log_registration_id ON scan_log(registration_id);
CREATE INDEX IF NOT EXISTS idx_scan_log_server_received_at ON scan_log(server_received_at DESC);
