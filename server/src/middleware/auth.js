const jwt = require('jsonwebtoken');
const db = require('../db');

function isAdminEmail(email) {
  if (!email || !process.env.ADMIN_EMAIL) return false;
  const adminEmails = process.env.ADMIN_EMAIL.split(',').map(e => e.trim().toLowerCase());
  return adminEmails.includes(email.trim().toLowerCase());
}

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
    decoded.is_admin = isAdminEmail(decoded.email);
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
    decoded.is_admin = isAdminEmail(decoded.email);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Admin check -- strictly matches ADMIN_EMAIL configured in environment
function requireAdmin(req, res, next) {
  if (!req.user || !isAdminEmail(req.user.email)) {
    return res.status(403).json({ error: 'Access restricted: Only the system administrator configured in environment variables has access' });
  }
  req.user.is_admin = true;
  next();
}

// Organizer check -- allows club organizers, direct event organizers, or dev admin
async function requireOrganizer(req, res, next) {
  const eventId = req.params.id || req.params.eventId;
  if (!eventId) {
    return res.status(400).json({ error: 'Event ID required' });
  }
  try {
    const isDevAdmin = isAdminEmail(req.user.email);
    const result = await db.query(
      `SELECT 1 
       FROM events e
       LEFT JOIN event_organizers eo ON eo.event_id = e.id AND eo.user_id = $2
       LEFT JOIN club_members cm ON cm.club_id = e.club_id AND cm.user_id = $2
       WHERE e.id = $1 AND (eo.user_id IS NOT NULL OR cm.user_id IS NOT NULL OR $3 = TRUE)`,
      [eventId, req.user.id, isDevAdmin]
    );
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Organizer access required for this event or club' });
    }
    next();
  } catch (err) {
    console.error('Organizer check error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { optionalAuth, requireAuth, requireAdmin, requireOrganizer, isAdminEmail };
