-- Ivent Club & Organizer Management SQL Queries
-- Use these queries in psql or pgAdmin to manage clubs and organizers.

-- 1. Create a new club
INSERT INTO clubs (name, description)
VALUES ('Coding Club', 'Technical coding and development club')
ON CONFLICT (name) DO NOTHING
RETURNING *;

-- 2. Make a user an Admin
-- (Replace user email with the target email)
UPDATE users
SET is_admin = TRUE
WHERE email = 'admin@ivent.local'
RETURNING id, email, is_admin;

-- 3. Link a user to a Club as an Organizer
-- (Replace club name and user email)
INSERT INTO club_members (club_id, user_id)
SELECT c.id, u.id
FROM clubs c, users u
WHERE c.name = 'Coding Club' AND u.email = 'organizer@ivent.local'
ON CONFLICT (club_id, user_id) DO NOTHING;

-- 4. View all clubs with their organizers
SELECT
  c.id AS club_id,
  c.name AS club_name,
  c.description,
  COUNT(cm.user_id) AS organizer_count,
  COALESCE(string_agg(u.email, ', '), 'None') AS organizers
FROM clubs c
LEFT JOIN club_members cm ON cm.club_id = c.id
LEFT JOIN users u ON u.id = cm.user_id
GROUP BY c.id, c.name, c.description
ORDER BY c.name ASC;

-- 5. View all events by club
SELECT
  e.id AS event_id,
  e.name AS event_name,
  e.event_date,
  e.capacity,
  e.registered_count,
  COALESCE(c.name, 'Independent / No Club') AS club_name,
  u.email AS created_by_email
FROM events e
LEFT JOIN clubs c ON e.club_id = c.id
LEFT JOIN users u ON e.created_by = u.id
ORDER BY e.event_date ASC;

-- 6. Remove an organizer from a club
DELETE FROM club_members
WHERE club_id = (SELECT id FROM clubs WHERE name = 'Coding Club')
  AND user_id = (SELECT id FROM users WHERE email = 'organizer@ivent.local');
