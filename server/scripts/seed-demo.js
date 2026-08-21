const db = require('../src/db');
const argon2 = require('argon2');
const { authenticator } = require('otplib');
const { v4: uuidv4 } = require('uuid');

async function seedDemoData() {
  console.log('Seeding demo data for screenshots...');

  // 1. Password hash
  const passwordHash = await argon2.hash('password123');

  // 2. Users
  const orgEmail = 'organizer@mic.local';
  const att1Email = 'sarah.attendee@mic.local';
  const att2Email = 'alex.developer@mic.local';

  await db.query("DELETE FROM users WHERE email IN ($1, $2, $3)", [orgEmail, att1Email, att2Email]);

  const orgRes = await db.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
    [orgEmail, passwordHash]
  );
  const orgUser = orgRes.rows[0];

  const att1Res = await db.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
    [att1Email, passwordHash]
  );
  const att1User = att1Res.rows[0];

  const att2Res = await db.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
    [att2Email, passwordHash]
  );
  const att2User = att2Res.rows[0];

  // 3. Club
  const clubName = 'MIC Tech Society';
  let clubRes = await db.query("SELECT id, name FROM clubs WHERE name = $1", [clubName]);
  let clubId;
  if (clubRes.rows.length === 0) {
    const newClub = await db.query(
      "INSERT INTO clubs (name, description) VALUES ($1, $2) RETURNING id, name",
      [clubName, 'Leading student technology and software development society']
    );
    clubId = newClub.rows[0].id;
  } else {
    clubId = clubRes.rows[0].id;
  }

  // Link organizer to club
  await db.query(
    "INSERT INTO club_members (club_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [clubId, orgUser.id]
  );

  // 4. Event
  const eventName = 'MIC National Hackathon 2026';
  await db.query("DELETE FROM events WHERE name = $1", [eventName]);

  const eventRes = await db.query(
    `INSERT INTO events (club_id, name, description, location, event_date, capacity, registered_count, created_by)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '2 days', 15, 2, $5)
     RETURNING id, name, capacity, registered_count`,
    [
      clubId,
      eventName,
      'Flagship 48-hour hardware and software innovation hackathon featuring university engineering teams.',
      'Main Innovation Auditorium & Lab',
      orgUser.id,
    ]
  );
  const event = eventRes.rows[0];

  // Link event organizer
  await db.query(
    "INSERT INTO event_organizers (event_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [event.id, orgUser.id]
  );

  // 5. Registrations
  const secret1 = authenticator.generateSecret();
  const secret2 = authenticator.generateSecret();

  const reg1Res = await db.query(
    `INSERT INTO registrations (event_id, user_id, totp_secret, checked_in_at, checked_in_by, checked_in_source)
     VALUES ($1, $2, $3, NOW() - INTERVAL '45 minutes', 'Main Entrance Station', 'online')
     RETURNING id, event_id, user_id, totp_secret, checked_in_at`,
    [event.id, att1User.id, secret1]
  );
  const reg1 = reg1Res.rows[0];

  // Log scan for reg1
  await db.query(
    `INSERT INTO scan_log (registration_id, station_id, client_scan_id, device_timestamp, result)
     VALUES ($1, 'Main Entrance Station', $2, NOW() - INTERVAL '45 minutes', 'accepted')`,
    [reg1.id, uuidv4()]
  );

  const reg2Res = await db.query(
    `INSERT INTO registrations (event_id, user_id, totp_secret)
     VALUES ($1, $2, $3)
     RETURNING id, event_id, user_id, totp_secret`,
    [event.id, att2User.id, secret2]
  );
  const reg2 = reg2Res.rows[0];

  console.log('Demo data seeded successfully:');
  console.log({
    eventId: event.id,
    eventName: event.name,
    organizer: orgEmail,
    attendee1: { email: att1Email, regId: reg1.id, checkedIn: true, secret: secret1 },
    attendee2: { email: att2Email, regId: reg2.id, checkedIn: false, secret: secret2 },
  });

  process.exit(0);
}

seedDemoData().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
