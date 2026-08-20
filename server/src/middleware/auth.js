const jwt = require('jsonwebtoken');
const db = require('../db');

// Optional auth -- sets req.user if valid JWT present, does not block
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
  } catch (err) {
    // Invalid token, proceed without user context
  }
  next();
}

// Required auth -- blocks with 401 if no valid JWT
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Organizer check -- must be called after requireAuth
async function requireOrganizer(req, res, next) {
  const eventId = req.params.id || req.params.eventId;
  if (!eventId) {
    return res.status(400).json({ error: 'Event ID required' });
  }
  try {
    const result = await db.query(
      'SELECT 1 FROM event_organizers WHERE event_id = $1 AND user_id = $2',
      [eventId, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Organizer access required for this event' });
    }
    next();
  } catch (err) {
    console.error('Organizer check error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { optionalAuth, requireAuth, requireOrganizer };
