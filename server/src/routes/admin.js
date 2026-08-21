const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin, isAdminEmail } = require('../middleware/auth');

const router = express.Router();

// All admin routes require auth and system admin validation
router.use(requireAuth);
router.use(requireAdmin);

// GET /admin/clubs -- list all clubs with organizer members
router.get('/clubs', async (req, res) => {
  try {
    const clubsResult = await db.query(
      `SELECT c.*,
              COUNT(DISTINCT cm.user_id) AS organizer_count,
              COUNT(DISTINCT e.id) AS event_count
       FROM clubs c
       LEFT JOIN club_members cm ON cm.club_id = c.id
       LEFT JOIN events e ON e.club_id = c.id
       GROUP BY c.id
       ORDER BY c.name ASC`
    );

    // Get members for each club
    const membersResult = await db.query(
      `SELECT cm.club_id, u.id AS user_id, u.email, cm.added_at
       FROM club_members cm
       JOIN users u ON u.id = cm.user_id
       ORDER BY u.email ASC`
    );

    const membersByClub = {};
    for (const m of membersResult.rows) {
      if (!membersByClub[m.club_id]) membersByClub[m.club_id] = [];
      membersByClub[m.club_id].push(m);
    }

    const clubs = clubsResult.rows.map(c => ({
      ...c,
      members: membersByClub[c.id] || [],
    }));

    res.json({ clubs });
  } catch (err) {
    console.error('List clubs error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /admin/clubs -- create a club (can also be done via SQL query)
router.post('/clubs', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Club name is required' });
    }

    const result = await db.query(
      'INSERT INTO clubs (name, description) VALUES ($1, $2) RETURNING *',
      [name.trim(), description || null]
    );

    res.status(201).json({ club: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A club with this name already exists' });
    }
    console.error('Create club error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /admin/clubs/:id -- delete a club
router.delete('/clubs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // Find all events belonging to this club to broadcast deletion
    const clubEvents = await db.query('SELECT id FROM events WHERE club_id = $1', [id]);
    const result = await db.query('DELETE FROM clubs WHERE id = $1 RETURNING id, name', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Club not found' });
    }

    const io = req.app.get('io');
    if (io) {
      clubEvents.rows.forEach(ev => {
        io.to(`event:${ev.id}`).emit('event:deleted', { eventId: ev.id });
        io.emit('event:deleted', { eventId: ev.id });
      });
    }

    res.json({ message: `Club "${result.rows[0].name}" deleted successfully` });
  } catch (err) {
    console.error('Admin delete club error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /admin/events -- list all events across all clubs for admin oversight
router.get('/events', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT e.*, c.name AS club_name, u.email AS creator_email,
              COUNT(r.id) FILTER (WHERE r.checked_in_at IS NOT NULL) AS checked_in_count
       FROM events e
       LEFT JOIN clubs c ON e.club_id = c.id
       LEFT JOIN users u ON e.created_by = u.id
       LEFT JOIN registrations r ON r.event_id = e.id
       GROUP BY e.id, c.name, u.email
       ORDER BY e.created_at DESC`
    );

    res.json({ events: result.rows });
  } catch (err) {
    console.error('List admin events error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /admin/events/:id -- admin delete any event
router.delete('/events/:id', async (req, res) => {
  try {
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
    console.error('Admin delete event error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /admin/users -- list all registered users with their clubs
router.get('/users', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.email, u.created_at,
              COALESCE(
                json_agg(
                  json_build_object('id', c.id, 'name', c.name)
                ) FILTER (WHERE c.id IS NOT NULL),
                '[]'
              ) AS clubs
       FROM users u
       LEFT JOIN club_members cm ON cm.user_id = u.id
       LEFT JOIN clubs c ON c.id = cm.club_id
       GROUP BY u.id, u.email, u.created_at
       ORDER BY u.created_at DESC`
    );

    const users = result.rows.map(u => ({
      ...u,
      is_admin: isAdminEmail(u.email),
    }));

    res.json({ users });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /admin/clubs/:clubId/members -- assign an organizer to a club by email
router.post('/clubs/:clubId/members', async (req, res) => {
  try {
    const { clubId } = req.params;
    const { email, userId } = req.body;

    let targetUserId = userId;
    let targetEmail = email;

    if (!targetUserId && targetEmail) {
      const cleanEmail = targetEmail.toLowerCase().trim();
      if (isAdminEmail(cleanEmail)) {
        return res.status(400).json({
          error: 'System administrator / developer cannot be added to a club',
        });
      }
      const userRes = await db.query(
        'SELECT id, email FROM users WHERE LOWER(email) = $1',
        [cleanEmail]
      );
      if (userRes.rows.length === 0) {
        return res.status(404).json({ error: 'No user found with that email address' });
      }
      targetUserId = userRes.rows[0].id;
      targetEmail = userRes.rows[0].email;
    }

    if (!targetUserId) {
      return res.status(400).json({ error: 'User email or ID is required' });
    }

    // Check if target user is admin
    if (isAdminEmail(targetEmail)) {
      return res.status(400).json({
        error: 'System administrator / developer cannot be added to a club',
      });
    }

    let addedByUserId = null;
    if (req.user?.id) {
      try {
        const userCheck = await db.query('SELECT id FROM users WHERE id = $1', [req.user.id]);
        if (userCheck.rows.length > 0) {
          addedByUserId = userCheck.rows[0].id;
        }
      } catch {
        // ignore if not a UUID
      }
    }

    await db.query(
      `INSERT INTO club_members (club_id, user_id, added_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (club_id, user_id) DO NOTHING`,
      [clubId, targetUserId, addedByUserId]
    );

    res.status(201).json({ message: 'Organizer linked to club successfully' });
  } catch (err) {
    console.error('Add club member error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /admin/clubs/:clubId/members/:userId -- remove organizer from a club
router.delete('/clubs/:clubId/members/:userId', async (req, res) => {
  try {
    const { clubId, userId } = req.params;
    await db.query(
      'DELETE FROM club_members WHERE club_id = $1 AND user_id = $2',
      [clubId, userId]
    );
    res.json({ message: 'Organizer removed from club' });
  } catch (err) {
    console.error('Remove club member error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
