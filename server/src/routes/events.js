const express = require('express');
const db = require('../db');
const { requireAuth, requireOrganizer, optionalAuth } = require('../middleware/auth');
const { getEventStats, getInsight } = require('../services/insights');

const router = express.Router();

// GET /events/clubs -- public list of clubs
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

// POST /events -- create event (requires user to be an admin or member of the club)
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, description, location, eventDate, capacity, clubId } = req.body;
    if (!name || !eventDate || !capacity) {
      return res.status(400).json({ error: 'Name, event date, and capacity are required' });
    }
    if (capacity < 1) {
      return res.status(400).json({ error: 'Capacity must be at least 1' });
    }

    // Verify user is an admin or organizer of the specified club
    const userRes = await db.query('SELECT is_admin FROM users WHERE id = $1', [req.user.id]);
    const isAdmin = userRes.rows[0]?.is_admin;

    let targetClubId = clubId || null;

    if (!isAdmin) {
      // User must be in at least one club
      const clubMemberships = await db.query(
        'SELECT club_id FROM club_members WHERE user_id = $1',
        [req.user.id]
      );
      if (clubMemberships.rows.length === 0) {
        return res.status(403).json({
          error: 'Only club organizers and administrators can create events. Contact an admin to get linked to a club.',
        });
      }

      if (targetClubId) {
        const isMember = clubMemberships.rows.some(m => m.club_id === targetClubId);
        if (!isMember) {
          return res.status(403).json({ error: 'You are not an organizer for the selected club' });
        }
      } else {
        // Default to first club user belongs to
        targetClubId = clubMemberships.rows[0].club_id;
      }
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

    if (req.user) {
      // Check if user is registered
      const regResult = await db.query(
        'SELECT id, checked_in_at, created_at FROM registrations WHERE event_id = $1 AND user_id = $2',
        [req.params.id, req.user.id]
      );
      if (regResult.rows.length > 0) {
        registration = regResult.rows[0];
      }

      // Check if user is organizer (admin, direct organizer, or member of event's club)
      const orgResult = await db.query(
        `SELECT 1 
         FROM events e
         LEFT JOIN event_organizers eo ON eo.event_id = e.id AND eo.user_id = $2
         LEFT JOIN club_members cm ON cm.club_id = e.club_id AND cm.user_id = $2
         JOIN users u ON u.id = $2
         WHERE e.id = $1 AND (u.is_admin = TRUE OR eo.user_id IS NOT NULL OR cm.user_id IS NOT NULL)`,
        [req.params.id, req.user.id]
      );
      isOrganizer = orgResult.rows.length > 0;
    }

    res.json({ event, registration, isOrganizer });
  } catch (err) {
    console.error('Get event error:', err);
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

    const userResult = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
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
