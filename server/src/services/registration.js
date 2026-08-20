const db = require('../db');
const { authenticator } = require('otplib');

class EventFullError extends Error {
  constructor() {
    super('Event is at full capacity');
    this.name = 'EventFullError';
    this.status = 409;
  }
}

class AlreadyRegisteredError extends Error {
  constructor() {
    super('Already registered for this event');
    this.name = 'AlreadyRegisteredError';
    this.status = 409;
  }
}

// Atomic capacity-checked registration -- no read-then-write gap
async function registerForEvent(eventId, userId) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Atomic increment with capacity guard -- single statement, row-locked
    const { rows: eventRows } = await client.query(
      `UPDATE events
       SET registered_count = registered_count + 1
       WHERE id = $1 AND registered_count < capacity
       RETURNING *`,
      [eventId]
    );
    if (eventRows.length === 0) {
      // Check if event exists at all
      const { rows: existCheck } = await client.query(
        'SELECT id, registered_count, capacity FROM events WHERE id = $1',
        [eventId]
      );
      await client.query('ROLLBACK');
      if (existCheck.length === 0) {
        const err = new Error('Event not found');
        err.status = 404;
        throw err;
      }
      throw new EventFullError();
    }

    const totpSecret = authenticator.generateSecret();

    const { rows: regRows } = await client.query(
      `INSERT INTO registrations (event_id, user_id, totp_secret)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id, user_id) DO NOTHING
       RETURNING *`,
      [eventId, userId, totpSecret]
    );

    if (regRows.length === 0) {
      // Undo the capacity increment since registration was a duplicate
      await client.query(
        'UPDATE events SET registered_count = registered_count - 1 WHERE id = $1',
        [eventId]
      );
      await client.query('COMMIT');
      throw new AlreadyRegisteredError();
    }

    await client.query('COMMIT');
    return regRows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { registerForEvent, EventFullError, AlreadyRegisteredError };
