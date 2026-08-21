const db = require('../db');
const { authenticator } = require('otplib');
const { v4: uuidv4 } = require('uuid');

// Configure TOTP with 30-second step and 1-step tolerance
authenticator.options = {
  step: 30,
  window: 1,
};

async function logScan(registrationId, stationId, clientScanId, deviceTimestamp, result) {
  try {
    await db.query(
      `INSERT INTO scan_log (registration_id, station_id, client_scan_id, device_timestamp, result)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (client_scan_id) DO NOTHING`,
      [registrationId, stationId, clientScanId, deviceTimestamp, result]
    );
  } catch (err) {
    console.error('Failed to log scan:', err);
  }
}

// Atomic check-in with duplicate prevention -- supports lookup by:
// 1. Registration UUID
// 2. Attendee Email (for the specific event)
// 3. Attendee Registration Number (for the specific event)
async function checkIn({ registrationId, eventId, totpCode, stationId, clientScanId, deviceTimestamp, io }) {
  const cleanIdentifier = (registrationId || '').trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanIdentifier);

  let reg;
  if (isUuid) {
    reg = await db.query(
      'SELECT id, totp_secret, checked_in_at, event_id FROM registrations WHERE id = $1',
      [cleanIdentifier]
    );
  }

  // If not found by registration UUID, look up by attendee email OR attendee reg_number
  if (!reg || !reg.rows[0]) {
    const params = eventId ? [cleanIdentifier.toLowerCase(), eventId] : [cleanIdentifier.toLowerCase()];
    const eventFilter = eventId ? 'AND r.event_id = $2' : '';

    reg = await db.query(
      `SELECT r.id, r.totp_secret, r.checked_in_at, r.event_id
       FROM registrations r
       JOIN users u ON u.id = r.user_id
       WHERE (LOWER(u.email) = $1 OR (u.reg_number IS NOT NULL AND LOWER(u.reg_number) = $1))
       ${eventFilter}
       ORDER BY r.created_at DESC
       LIMIT 1`,
      params
    );
  }

  if (!reg || !reg.rows[0]) {
    return { status: 'not_found' };
  }

  const { id: actualRegistrationId, totp_secret, event_id: targetEventId } = reg.rows[0];

  // Verify TOTP code (current step +/- 1 for clock drift tolerance)
  const cleanTotp = (totpCode || '').toString().trim().replace(/\s+/g, '');
  const isValid = authenticator.check(cleanTotp, totp_secret);
  if (!isValid) {
    await logScan(actualRegistrationId, stationId, clientScanId, deviceTimestamp, 'rejected_invalid_totp');
    return { status: 'rejected_invalid_totp', message: 'Invalid or expired 30-second auth code' };
  }

  // Atomic check-in: UPDATE only if not already checked in
  const { rows } = await db.query(
    `UPDATE registrations
     SET checked_in_at = NOW(),
         checked_in_by = $2,
         checked_in_source = 'online',
         client_scan_id = $3
     WHERE id = $1 AND checked_in_at IS NULL
     RETURNING checked_in_at`,
    [actualRegistrationId, stationId, clientScanId]
  );

  if (rows.length === 0) {
    // Already checked in -- duplicate scan
    const existing = await db.query(
      'SELECT checked_in_at FROM registrations WHERE id = $1',
      [actualRegistrationId]
    );
    const checkedInAt = existing.rows[0]?.checked_in_at;
    const timeStr = checkedInAt ? new Date(checkedInAt).toLocaleTimeString() : 'earlier';
    await logScan(actualRegistrationId, stationId, clientScanId, deviceTimestamp, 'rejected_duplicate');
    return {
      status: 'rejected_duplicate',
      checkedInAt,
      message: `Already checked in at ${timeStr}`,
    };
  }

  await logScan(actualRegistrationId, stationId, clientScanId, deviceTimestamp, 'accepted');

  // Push real-time update via Socket.io
  if (io) {
    io.to(`event:${targetEventId}`).emit('checkin', {
      registrationId: actualRegistrationId,
      checkedInAt: rows[0].checked_in_at,
    });
  }

  return { status: 'accepted', message: 'Check-in accepted', checkedInAt: rows[0].checked_in_at };
}

// Sync a single offline scan -- idempotent on client_scan_id
async function syncOfflineScan(scan, io) {
  const already = await db.query(
    'SELECT result FROM scan_log WHERE client_scan_id = $1',
    [scan.clientScanId]
  );
  if (already.rows[0]) {
    return { status: already.rows[0].result, alreadyProcessed: true };
  }
  return checkIn({ ...scan, io });
}

module.exports = { checkIn, syncOfflineScan };
