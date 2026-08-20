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

// Atomic check-in with duplicate prevention -- single UPDATE statement
async function checkIn({ registrationId, totpCode, stationId, clientScanId, deviceTimestamp, io }) {
  // Look up registration and its TOTP secret
  const reg = await db.query(
    'SELECT totp_secret, checked_in_at, event_id FROM registrations WHERE id = $1',
    [registrationId]
  );
  if (!reg.rows[0]) {
    return { status: 'not_found' };
  }

  const { totp_secret, event_id } = reg.rows[0];

  // Verify TOTP code (current step +/- 1 for clock drift tolerance)
  const isValid = authenticator.check(totpCode, totp_secret);
  if (!isValid) {
    await logScan(registrationId, stationId, clientScanId, deviceTimestamp, 'rejected_invalid_totp');
    return { status: 'rejected_invalid_totp' };
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
    [registrationId, stationId, clientScanId]
  );

  if (rows.length === 0) {
    // Already checked in -- duplicate scan
    const existing = await db.query(
      'SELECT checked_in_at FROM registrations WHERE id = $1',
      [registrationId]
    );
    await logScan(registrationId, stationId, clientScanId, deviceTimestamp, 'rejected_duplicate');
    return { status: 'rejected_duplicate', checkedInAt: existing.rows[0].checked_in_at };
  }

  await logScan(registrationId, stationId, clientScanId, deviceTimestamp, 'accepted');

  // Push real-time update via Socket.io
  if (io) {
    io.to(`event:${event_id}`).emit('checkin', {
      registrationId,
      checkedInAt: rows[0].checked_in_at,
    });
  }

  return { status: 'accepted', checkedInAt: rows[0].checked_in_at };
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
