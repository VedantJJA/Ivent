const express = require('express');
const db = require('../db');
const { requireAuth, requireOrganizer, optionalAuth, isAdminEmail } = require('../middleware/auth');
const { getEventStats, getInsight } = require('../services/insights');

const router = express.Router();

// GET /events/clubs/list -- public list of clubs
router.get('/clubs/list', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, COUNT(e.id) AS event_count
       FROM clubs c
       LEFT JOIN events e ON e.club_id = c.id
       GROUP BY c.id
       ORDER BY c.name ASC`
    );
    res.json({ clubs: result.rows });
  } catch (err) {
    console.error('List clubs error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /events/organizer/clubs -- get clubs user is an organizer of + their hosted events
router.get('/organizer/clubs', requireAuth, async (req, res) => {
  try {
    if (isAdminEmail(req.user.email)) {
      return res.json({ clubs: [] });
    }

    // Get clubs the user is a member of
    const clubsResult = await db.query(
      `SELECT c.*, cm.added_at as joined_at
       FROM clubs c
       JOIN club_members cm ON cm.club_id = c.id
       WHERE cm.user_id = $1
       ORDER BY c.name ASC`,
      [req.user.id]
    );

    const clubs = clubsResult.rows;

    // Get all events for these clubs with registration and check-in counts
    const clubIds = clubs.map(c => c.id);
    let events = [];
    if (clubIds.length > 0) {
      const eventsResult = await db.query(
        `SELECT e.*, c.name AS club_name,
                COUNT(r.id) FILTER (WHERE r.checked_in_at IS NOT NULL) AS checked_in_count
         FROM events e
         JOIN clubs c ON e.club_id = c.id
         LEFT JOIN registrations r ON r.event_id = e.id
         WHERE e.club_id = ANY($1::uuid[])
         GROUP BY e.id, c.name
         ORDER BY e.event_date DESC`,
        [clubIds]
      );
      events = eventsResult.rows;
    }

    // Group events by club
    const eventsByClub = {};
    for (const ev of events) {
      if (!eventsByClub[ev.club_id]) eventsByClub[ev.club_id] = [];
      eventsByClub[ev.club_id].push(ev);
    }

    const clubsWithEvents = clubs.map(c => ({
      ...c,
      events: eventsByClub[c.id] || [],
    }));

    res.json({ clubs: clubsWithEvents });
  } catch (err) {
    console.error('Organizer clubs error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /events -- create event (requires user to be an organizer of the specified club; admins cannot create events)
router.post('/', requireAuth, async (req, res) => {
  try {
    if (isAdminEmail(req.user.email)) {
      return res.status(403).json({
        error: 'Administrators and developers cannot create events. Only club organizers can create events for their clubs.',
      });
    }

    const { name, description, location, eventDate, capacity, clubId } = req.body;
    if (!name || !eventDate || !capacity) {
      return res.status(400).json({ error: 'Name, event date, and capacity are required' });
    }
    if (capacity < 1) {
      return res.status(400).json({ error: 'Capacity must be at least 1' });
    }

    // Verify user is in at least one club
    const clubMemberships = await db.query(
      'SELECT club_id FROM club_members WHERE user_id = $1',
      [req.user.id]
    );
    if (clubMemberships.rows.length === 0) {
      return res.status(403).json({
        error: 'Only club organizers can create events. You are not currently linked to any club.',
      });
    }

    let targetClubId = clubId;
    if (targetClubId) {
      const isMember = clubMemberships.rows.some(m => m.club_id === targetClubId);
      if (!isMember) {
        return res.status(403).json({ error: 'You are not an organizer for the selected club' });
      }
    } else {
      targetClubId = clubMemberships.rows[0].club_id;
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const eventResult = await client.query(
        `INSERT INTO events (name, description, location, event_date, capacity, created_by, club_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [name, description || null, location || null, eventDate, capacity, req.user.id, targetClubId]
      );

      const event = eventResult.rows[0];

      // Insert creator as direct event organizer
      await client.query(
        'INSERT INTO event_organizers (event_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [event.id, req.user.id]
      );

      await client.query('COMMIT');
      res.status(201).json({ event });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Create event error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /events -- public list (no auth required)
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT e.*, u.email as creator_email, c.name as club_name
       FROM events e
       LEFT JOIN users u ON e.created_by = u.id
       LEFT JOIN clubs c ON e.club_id = c.id
       ORDER BY e.event_date ASC`
    );
    res.json({ events: result.rows });
  } catch (err) {
    console.error('List events error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /events/:id -- public event detail (no auth required, optional auth for registration status)
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT e.*, u.email as creator_email, c.name as club_name, c.id as club_id
       FROM events e
       LEFT JOIN users u ON e.created_by = u.id
       LEFT JOIN clubs c ON e.club_id = c.id
       WHERE e.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const event = result.rows[0];
    let registration = null;
    let isOrganizer = false;
    const isSystemAdmin = req.user ? isAdminEmail(req.user.email) : false;

    if (req.user) {
      // Check if user is registered
      const regResult = await db.query(
        'SELECT id, checked_in_at, created_at FROM registrations WHERE event_id = $1 AND user_id = $2',
        [req.params.id, req.user.id]
      );
      if (regResult.rows.length > 0) {
        registration = regResult.rows[0];
      }

      // Check if user is organizer
      const orgResult = await db.query(
        `SELECT 1 
         FROM events e
         LEFT JOIN event_organizers eo ON eo.event_id = e.id AND eo.user_id = $2
         LEFT JOIN club_members cm ON cm.club_id = e.club_id AND cm.user_id = $2
         WHERE e.id = $1 AND (eo.user_id IS NOT NULL OR cm.user_id IS NOT NULL OR $3 = TRUE)`,
        [req.params.id, req.user.id, isSystemAdmin]
      );
      isOrganizer = orgResult.rows.length > 0;
    }

    res.json({ event, registration, isOrganizer, isAdmin: isSystemAdmin });
  } catch (err) {
    console.error('Get event error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /events/:id -- delete event (allowed for admin or club/event organizers)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const isSystemAdmin = isAdminEmail(req.user.email);

    // If not admin, check organizer permission
    if (!isSystemAdmin) {
      const orgCheck = await db.query(
        `SELECT 1 
         FROM events e
         LEFT JOIN event_organizers eo ON eo.event_id = e.id AND eo.user_id = $2
         LEFT JOIN club_members cm ON cm.club_id = e.club_id AND cm.user_id = $2
         WHERE e.id = $1 AND (eo.user_id IS NOT NULL OR cm.user_id IS NOT NULL)`,
        [req.params.id, req.user.id]
      );
      if (orgCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Permission denied: only event organizers or admins can delete this event' });
      }
    }

    const result = await db.query('DELETE FROM events WHERE id = $1 RETURNING id, name', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`event:${req.params.id}`).emit('event:deleted', { eventId: req.params.id });
      io.emit('event:deleted', { eventId: req.params.id });
    }

    res.json({ message: `Event "${result.rows[0].name}" deleted successfully`, eventId: req.params.id });
  } catch (err) {
    console.error('Delete event error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /events/:id/organizers -- add co-organizer (organizer only)
router.post('/:id/organizers', requireAuth, requireOrganizer, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email of the new organizer is required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    if (isAdminEmail(cleanEmail)) {
      return res.status(400).json({ error: 'System administrator cannot be added as an organizer' });
    }

    const userResult = await db.query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'No user found with that email' });
    }

    const userId = userResult.rows[0].id;

    await db.query(
      'INSERT INTO event_organizers (event_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.params.id, userId]
    );

    res.json({ message: 'Organizer added successfully' });
  } catch (err) {
    console.error('Add organizer error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /events/:id/dashboard -- organizer-only live dashboard data
router.get('/:id/dashboard', requireAuth, requireOrganizer, async (req, res) => {
  try {
    const eventResult = await db.query(
      `SELECT e.*, c.name as club_name
       FROM events e
       LEFT JOIN clubs c ON e.club_id = c.id
       WHERE e.id = $1`,
      [req.params.id]
    );
    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const registrations = await db.query(
      `SELECT r.id, r.checked_in_at, r.checked_in_by, r.checked_in_source, r.created_at,
              u.email
       FROM registrations r
       JOIN users u ON r.user_id = u.id
       WHERE r.event_id = $1
       ORDER BY r.created_at ASC`,
      [req.params.id]
    );

    const scanLog = await db.query(
      `SELECT sl.*
       FROM scan_log sl
       JOIN registrations r ON sl.registration_id = r.id
       WHERE r.event_id = $1
       ORDER BY sl.server_received_at DESC
       LIMIT 50`,
      [req.params.id]
    );

    res.json({
      event: eventResult.rows[0],
      registrations: registrations.rows,
      recentScans: scanLog.rows,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /events/:id/export.csv -- organizer-only CSV export
router.get('/:id/export.csv', requireAuth, requireOrganizer, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.email, r.created_at as registered_at, r.checked_in_at,
              r.checked_in_by, r.checked_in_source
       FROM registrations r
       JOIN users u ON r.user_id = u.id
       WHERE r.event_id = $1
       ORDER BY r.created_at ASC`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(200).send('email,registered_at,checked_in_at,checked_in_by,checked_in_source\n');
    }

    const { Parser } = require('json2csv');
    const fields = ['email', 'registered_at', 'checked_in_at', 'checked_in_by', 'checked_in_source'];
    const parser = new Parser({ fields });
    const csv = parser.parse(result.rows);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="event-${req.params.id}-attendees.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('CSV export error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /events/:id/insights -- organizer-only AI insights
router.post('/:id/insights', requireAuth, requireOrganizer, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const stats = await getEventStats(req.params.id);
    if (!stats) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const result = await getInsight(question, stats);
    res.json(result);
  } catch (err) {
    console.error('Insights error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
