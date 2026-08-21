const express = require('express');
const db = require('../db');
const { requireAuth, isAdminEmail } = require('../middleware/auth');
const { registerForEvent, EventFullError, AlreadyRegisteredError } = require('../services/registration');

const router = express.Router();

// POST /events/:id/register -- atomic capacity-checked registration
router.post('/events/:id/register', requireAuth, async (req, res) => {
  try {
    if (isAdminEmail(req.user.email)) {
      return res.status(403).json({ error: 'System administrators and developers cannot register for events' });
    }

    // Check if user is an organizer of this event or the hosting club
    const orgCheck = await db.query(
      `SELECT 1 
       FROM events e
       LEFT JOIN event_organizers eo ON eo.event_id = e.id AND eo.user_id = $2
       LEFT JOIN club_members cm ON cm.club_id = e.club_id AND cm.user_id = $2
       WHERE e.id = $1 AND (eo.user_id IS NOT NULL OR cm.user_id IS NOT NULL OR e.created_by = $2)`,
      [req.params.id, req.user.id]
    );
    if (orgCheck.rows.length > 0) {
      return res.status(403).json({
        error: 'Organizers cannot participate in or register for events they are hosting.',
      });
    }

    const registration = await registerForEvent(req.params.id, req.user.id);
    res.status(201).json({ registration });
  } catch (err) {
    if (err instanceof EventFullError) {
      return res.status(409).json({ error: err.message });
    }
    if (err instanceof AlreadyRegisteredError) {
      return res.status(409).json({ error: err.message });
    }
    if (err.status === 404) {
      return res.status(404).json({ error: err.message });
    }
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /registrations/:id/secret -- auth-gated TOTP secret fetch (owning user only)
router.get('/registrations/:id/secret', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT r.totp_secret, r.user_id, r.checked_in_at, e.name as event_name, u.email
       FROM registrations r
       JOIN events e ON r.event_id = e.id
       JOIN users u ON r.user_id = u.id
       WHERE r.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Registration not found' });
    }

    const registration = result.rows[0];
    if (registration.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only view your own registration secret' });
    }

    res.json({
      secret: registration.totp_secret,
      checkedInAt: registration.checked_in_at,
      eventName: registration.event_name,
      email: registration.email,
    });
  } catch (err) {
    console.error('Get secret error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /registrations/my -- list current user's registrations with preloaded secrets for offline PWA
router.get('/registrations/my', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT r.id, r.event_id, r.totp_secret, r.checked_in_at, r.created_at,
              e.name as event_name, e.event_date, e.capacity, e.registered_count,
              u.email
       FROM registrations r
       JOIN events e ON r.event_id = e.id
       JOIN users u ON r.user_id = u.id
       WHERE r.user_id = $1
       ORDER BY e.event_date ASC`,
      [req.user.id]
    );
    res.json({ registrations: result.rows });
  } catch (err) {
    console.error('My registrations error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
