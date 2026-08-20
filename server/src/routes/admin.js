const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// All admin routes require auth and is_admin = true
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

// GET /admin/users -- list all registered users with their clubs and admin status
router.get('/users', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.email, u.is_admin, u.created_at,
              COALESCE(
                json_agg(
                  json_build_object('id', c.id, 'name', c.name)
                ) FILTER (WHERE c.id IS NOT NULL),
                '[]'
              ) AS clubs
       FROM users u
       LEFT JOIN club_members cm ON cm.user_id = u.id
       LEFT JOIN clubs c ON c.id = cm.club_id
       GROUP BY u.id, u.email, u.is_admin, u.created_at
       ORDER BY u.created_at DESC`
    );

    res.json({ users: result.rows });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /admin/clubs/:clubId/members -- assign an organizer to a club
router.post('/clubs/:clubId/members', async (req, res) => {
  try {
    const { clubId } = req.params;
    const { email, userId } = req.body;

    let targetUserId = userId;
    if (!targetUserId && email) {
      const userRes = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
      if (userRes.rows.length === 0) {
        return res.status(404).json({ error: 'User with this email not found' });
      }
      targetUserId = userRes.rows[0].id;
    }

    if (!targetUserId) {
      return res.status(400).json({ error: 'User email or ID is required' });
    }

    await db.query(
      `INSERT INTO club_members (club_id, user_id, added_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (club_id, user_id) DO NOTHING`,
      [clubId, targetUserId, req.user.id]
    );

    res.json({ message: 'Organizer linked to club successfully' });
  } catch (err) {
    console.error('Add club member error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /admin/clubs/:clubId/members/:userId -- remove organizer status from a club
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

// POST /admin/users/:userId/toggle-admin -- toggle admin status
router.post('/users/:userId/toggle-admin', async (req, res) => {
  try {
    const { userId } = req.params;
    const userRes = await db.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const currentAdmin = userRes.rows[0].is_admin;
    const updated = await db.query(
      'UPDATE users SET is_admin = $1 WHERE id = $2 RETURNING id, email, is_admin',
      [!currentAdmin, userId]
    );

    res.json({ user: updated.rows[0] });
  } catch (err) {
    console.error('Toggle admin error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
