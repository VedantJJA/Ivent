const db = require('../src/db');
const argon2 = require('argon2');
require('dotenv').config();

async function seedDemoUsers() {
  console.log('Seeding specified demo accounts into database...');
  
  const orgPassHash = await argon2.hash('12341234');
  const attPassHash = await argon2.hash('43214321');

  // Ensure default clubs exist
  let clubRes = await db.query('SELECT id, name FROM clubs ORDER BY created_at ASC');
  if (clubRes.rows.length === 0) {
    await db.query(`
      INSERT INTO clubs (id, name, description) VALUES 
      (gen_random_uuid(), 'MIC Tech & Innovation Society', 'Flagship engineering club'),
      (gen_random_uuid(), 'Coding Club', 'Competitive programming and open source'),
      (gen_random_uuid(), 'Robotics & Hardware Lab', 'Hardware and IoT innovation')
    `);
    clubRes = await db.query('SELECT id, name FROM clubs ORDER BY created_at ASC');
  }

  const orgs = ['org1@test.com', 'org2@test.com', 'org3@test.com'];
  for (let i = 0; i < orgs.length; i++) {
    const email = orgs[i];
    const userRes = await db.query(`
      INSERT INTO users (email, password_hash)
      VALUES ($1, $2)
      ON CONFLICT (email) DO UPDATE SET password_hash = $2
      RETURNING id
    `, [email, orgPassHash]);
    const userId = userRes.rows[0].id;
    const targetClub = clubRes.rows[i % clubRes.rows.length];
    await db.query(`
      INSERT INTO club_members (club_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT (club_id, user_id) DO NOTHING
    `, [targetClub.id, userId]);
    console.log(`✓ Organizer: ${email} (Password: 12341234) -> Club: ${targetClub.name}`);
  }

  const atts = ['at1@test.com', 'at2@test.com', 'at3@test.com'];
  for (const email of atts) {
    await db.query(`
      INSERT INTO users (email, password_hash)
      VALUES ($1, $2)
      ON CONFLICT (email) DO UPDATE SET password_hash = $2
      RETURNING id
    `, [email, attPassHash]);
    console.log(`✓ Attendee: ${email} (Password: 43214321)`);
  }

  console.log('\nAll demo organizer and attendee accounts are ready.');
  process.exit(0);
}

seedDemoUsers().catch(err => {
  console.error('Error seeding demo users:', err);
  process.exit(1);
});
