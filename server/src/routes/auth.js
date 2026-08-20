const express = require('express');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Helper to fetch user's club memberships
async function getUserClubs(userId) {
  const result = await db.query(
    `SELECT c.id, c.name, c.description
     FROM clubs c
     JOIN club_members cm ON cm.club_id = c.id
     WHERE cm.user_id = $1
     ORDER BY c.name ASC`,
    [userId]
  );
  return result.rows;
}

// POST /auth/register -- create user account (attendee by default, is_admin = false)
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    // Check if this is the very first user in the system; if so, make them admin
    const totalUsers = await db.query('SELECT COUNT(*) as count FROM users');
    const isFirstUser = parseInt(totalUsers.rows[0].count, 10) === 0;

    const passwordHash = await argon2.hash(password);
    const result = await db.query(
      'INSERT INTO users (email, password_hash, is_admin) VALUES ($1, $2, $3) RETURNING id, email, is_admin, created_at',
      [email.toLowerCase(), passwordHash, isFirstUser]
    );

    const user = result.rows[0];
    const clubs = await getUserClubs(user.id);

    const token = jwt.sign(
      { id: user.id, email: user.email, is_admin: user.is_admin },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({ user: { ...user, clubs }, token });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /auth/login -- authenticate and return JWT with club and admin status
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await db.query(
      'SELECT id, email, password_hash, is_admin, created_at FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const validPassword = await argon2.verify(user.password_hash, password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const clubs = await getUserClubs(user.id);

    const token = jwt.sign(
      { id: user.id, email: user.email, is_admin: user.is_admin },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      user: {
        id: user.id,
        email: user.email,
        is_admin: user.is_admin,
        clubs,
        created_at: user.created_at,
      },
      token,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /auth/me -- return current user with is_admin and clubs list
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, email, is_admin, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    const clubs = await getUserClubs(user.id);

    res.json({
      user: {
        ...user,
        clubs,
      },
    });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
