const jwt = require('jsonwebtoken');
const db = require('../db');

// Extract token from Authorization header or query parameter
function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  // Fallback to query param (used for CSV download via window.open)
  if (req.query && req.query.token) {
    return req.query.token;
  }
  return null;
}

// Optional auth -- sets req.user if valid JWT present, does not block
function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return next();
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
  } catch (err) {
    // Invalid token, proceed without user context
  }
  next();
}

// Required auth -- blocks with 401 if no valid JWT
function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
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
